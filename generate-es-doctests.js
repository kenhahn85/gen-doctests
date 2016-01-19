"use strict";

const _ = require('lodash');
const beautify = require('js-beautify').js_beautify;
const ESDoc = require('esdoc');
const fs = require('fs');
const invariant = require('invariant');
const mkdirp = require('mkdirp');
const mustache = require('mustache');
const path = require('path');
const XRegExp = require('xregexp');

const ESDOC_CONFIG = {source: './tmp', destination: './doc'};
const IMPORT_REGEX = XRegExp('\\{(?<moduleName>[A-Za-z0-9_]+)\\}');

const mustacheTemplates = {
  // TODO: add default imports
  file: `
// auto-generated test file
{{{imports}}}

{{{moduleBlocks}}}
`,

  moduleBlock: `
  QUnit.module("{{{moduleName}}}", {
  beforeEach: {{{beforeEach}}},
afterEach: {{{afterEach}}}
});


{{{testBlocks}}}`,

  testBlock: `
QUnit.test("{{{testName}}}", (assert) => {
  {{{testCode}}}
});
`
}

for(let k in mustacheTemplates) {
  mustache.parse(mustacheTemplates[k]);
}

class WritableTreeNode {}

class File extends WritableTreeNode {
  constructor(data) {
    super();
    this.filename = data.name.slice(0, -3);
    this.defaultNode = null;
    this.nodes = [];
  }

  containsNode(node) {
    return node.moduleName.indexOf(this.filename) === 0;
  }

  addNode(node) {
    invariant(node instanceof Exportable, "can only add Exportable's to File syntax trees")
    if (node.isDefaultExport) {
      this.defaultNode = node;
    } else {
      this.nodes.push(node);
    }
  }

  isWritable() {
    return this.defaultNode || this.nodes.length;
  }

  getTestFilename() {
    return `tests/${this.filename}-auto-generated.es6.js`;
  }

  write () {
    if (!this.isWritable()) {
      return null;
    }

    const imports = this.writeImportsLine();
    const moduleBlocks = this.nodes.map(v => v.write());
    const code = mustache.render(mustacheTemplates.file, {
      imports: imports,
      moduleBlocks: moduleBlocks
    });
    return beautify(code, {
      indent_size: 2
    });
  }
  
  writeToFile() {
    const contents = this.write();
    if (!contents) {
      return;
    } else {
      const testFileName = this.getTestFilename();
      mkdirp.sync(path.dirname(testFileName));
      fs.writeFileSync(testFileName, contents);
    }
  }

  writeImportsLine () {
    if (!this.defaultNode && !this.nodes.length) {
      return null;
    }

    let importsLine = 'import';
    if (this.defaultNode) {
      importsLine += ' ' + this.defaultNode.importName;
    }
    if (this.nodes.length) {
      if (this.defaultNode) {
        importsLine += ', ';
      }

      importsLine += '{';
      importsLine += this.nodes.map(e => e.importName).join(', ');
      importsLine += '}';
    }

    // TODO: normalize this filename based on root dir of webpack/browserify
    importsLine += ` from '${this.filename}';`;

    return importsLine;
  }
}

class Exportable extends WritableTreeNode {
  constructor(data) {
    super();

    invariant(data.export, "Nodes must be exportable.");

    const result = XRegExp.exec(data.importStyle, IMPORT_REGEX);
    if (result === null) {
      this.isDefaultExport = true;
      this.importName = data.importStyle;
    } else {
      this.isDefaultExport = false;
      this.importName = result.moduleName;
    }

    this.moduleName = Exportable.computeModuleName(data);
  }

  static build(klass, nodeData) {
    if (!nodeData.export) {
      return null;
    } else {
      return new klass(nodeData);
    }
  }

  static computeModuleName(data) {
    return data.longname;
  }
}

class Func extends Exportable {
  constructor(data) {
    super(data);
    this.afterEach = ModuleWriter.computeAfterEach(data);
    this.beforeEach = ModuleWriter.computeBeforeEach(data);
    this.testCodeBlocks = TestWriter.getTestCode(data);
  }

  write() {
    return ModuleWriter.write(
      this.afterEach,
      this.beforeEach,
      this.moduleName,
      TestWriter.write(this.testCodeBlocks)
    );
  }
}

class ModuleWriter {
  static computeBeforeEach(data) {
    if (!data.unknown) {
      return 'function() {}';
    }
    const beforeEach = data.unknown.filter(v => v.tagName === '@xBeforeEach');
    if (beforeEach.length === 0) {
      return '';
    } else if (beforeEach > 1) {
      throw new Error("Only one @xBeforeEach statement allowed");
    } else {
      return beforeEach[0].tagValue;
    }
  }

  static computeAfterEach(data) {
    if (!data.unknown) {
      return 'function() {}';
    }
    const afterEach = data.unknown.filter(v => v.tagName === '@xAfterEach');
    if (afterEach.length === 0) {
      return '';
    } else if (afterEach > 1) {
      throw new Error("Only one @xAfterEach statement allowed");
    } else {
      return afterEach[0].tagValue;
    }
  }

  /**
   *
   * @param afterEach
   * @param beforeEach
   * @param moduleName
   * @param testBlocks
   * @returns {String}
   */
  static write(afterEach, beforeEach, moduleName, testBlocks) {
    return mustache.render(mustacheTemplates.moduleBlock, {
      afterEach: afterEach,
      beforeEach: beforeEach,
      moduleName: moduleName,
      testBlocks: testBlocks
    });
  }
}

class TestWriter {
  static computeTestName(idx) {
    return `test #${idx}`;
  }

  static getTestCode(data) {
    if (!data.unknown) {
      return '';
    }
    return data.unknown
      .filter(v => v.tagName === '@xTestCase')
      .map(v => v.tagValue);
  }

  static write(testCodeBlocks) {
    return testCodeBlocks.map((v, idx) => {
      return mustache.render(mustacheTemplates.testBlock, {
        testName: TestWriter.computeTestName(idx),
        testCode: v
      });
    }).join("\n\n");
  }
}

class Class extends Exportable {
  constructor(data) {
    super(data);
    this.afterEach = ModuleWriter.computeAfterEach(data);
    this.beforeEach = ModuleWriter.computeBeforeEach(data);
    this.methods = [];
  }
  write() {
    return ModuleWriter.write(
      this.afterEach,
      this.beforeEach,
      this.moduleName,
      this.methods.map(v => v.write()).join("\n\n")
    );
  }
  
  addNode(node) {
    invariant(node instanceof Method, "This method only accepts Method instances"); 
    this.methods.push(node);
  }
}

class Method extends WritableTreeNode {
  constructor(data) {
    super(data);
    this.testCodeBlocks = TestWriter.getTestCode(data);
    invariant(
      _.every(this.testCodeBlocks, c => c.indexOf('assert(') >= 0 || c.indexOf('assert.') >= 0),
      '@xTestCase code blocks must contain assertions.'
    );
  }

  computeTestName(idx) {
    return `test case #${idx}`;
  }

  write() {
    return TestWriter.write(this.testCodeBlocks);
  }
}

/**
 * TODO: make this shit a state machine
 * TODO: diff detection?
 * @param results
 * @param config
 */
function publisher(results, config) {
  let currentFile = null;
  let currentClass = null;
  // start with an empty class
  //let currentGroup = new CurrentGroup();
  results.forEach(v => {
    // TODO: TEMPORARY
    switch (v.kind) {
      case 'file':
        if (currentFile !== null) {
          currentFile.writeToFile();
        }

        currentFile = new File(v);
        break;
      case 'class':
        if (v.export) {
          currentClass = new Class(v);
          currentFile.addNode(currentClass);
        }
        break;
      case 'method':
        currentClass.addNode(new Method(v));
        break;
      case 'function':
        if (v.export) {
          currentFile.addNode(new Func(v));
        }
        break;
      // TODO: case for function and method
    }
  });

  currentFile.writeToFile();
}

/**
 *   { __docId__: 1,
    kind: 'class',
    static: true,
    variation: null,
    name: 'TestFactory',
    memberof: 'tmp/test.js',
    longname: 'tmp/test.js~TestFactory',
    access: null,
    export: true,
    importPath: 'gen-js-doctests/tmp/test.js',
    importStyle: '{TestFactory}',
    description: null,
    examples: [ 'TestFactory(structure);' ],
    lineNumber: 8,
    unknown: [ [Object] ],
    interface: false },
 { __docId__: 2,
   kind: 'method',
   static: false,
   variation: null,
   name: 'test',
   memberof: 'tmp/test.js~TestFactory',
   longname: 'tmp/test.js~TestFactory#test',
   access: null,
   description: null,
   examples: [ 'TestFactory.test(structure);' ],
   lineNumber: 14,
   unknown: [ [Object] ],
   params: [],
   generator: false },
 */

ESDoc.generate(ESDOC_CONFIG, publisher);

