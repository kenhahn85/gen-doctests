"use strict";

// TODO: convert all sync actions to async
// TODO: support @xExternalImports
// TODO: import all exported members of the current file for a test
// TODO: divvy up tests by function / class rather than file...OR create mechanism to de-dupe imports within a file and track them. the former will probably have fewer edge cases.
// TODO: do not scan test files, i.e. add an excluded patterns arg
const _ = require('lodash');
const beautify = require('js-beautify').js_beautify;
const del = require('del');
const ESDoc = require('esdoc');
const fs = require('fs');
const invariant = require('invariant');
const mkdirp = require('mkdirp');
const mustache = require('mustache');
const path = require('path');
const XRegExp = require('xregexp');

const ESDOC_CONFIG = {source: './media/js', destination: './DOES NOT MATTER'};
const IMPORT_REGEX = XRegExp('\\{(?<moduleName>[A-Za-z0-9_]+)\\}');

// TODO: make this an argument to the exported method
const TEST_DIR = './tests/js/doctests';

const mustacheTemplates = {
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

// TODO: improve this to look for last index of or something else
// TODO: make this an argument to the script
const BASE_JS_DIR = 'js/';
function relativizeFileName(filename) {
  return filename.slice(filename.indexOf(BASE_JS_DIR) + BASE_JS_DIR.length);
}

class WritableTreeNode {
  isWritable() {
    throw new Error('Not implemented.');
  }
}

class File extends WritableTreeNode {
  constructor(data) {
    super();
    invariant(data.name.endsWith('.js'), 'Only JS files are allowed.');
    this.filename = data.name.endsWith('.es6.js') ? data.name.slice(0, -7) : data.name.slice(0, -3);
    this.defaultNode = null;
    this.nodes = [];
  }

  containsNode(node) {
    return node.moduleName.indexOf(this.filename) === 0;
  }

  addNode(node) {
    invariant(node instanceof Exportable, "can only add Exportable's to File syntax trees")
    if (!node.isWritable()) {
      return;
    }
    if (node.isDefaultExport) {
      this.defaultNode = node;
    } else {
      this.nodes.push(node);
    }
  }

  // TODO: refactor this method so the extra condition is not required
  isWritable() {
    return this.defaultNode || this.nodes.length;
  }

  getTestFilename() {
    const parts = this.filename.split('/');
    const filename = parts.pop();
    const path = parts.join('/');
    return `${TEST_DIR}/${path}/test_${filename}-auto-generated.es6.js`;
  }

  write () {
    if (!this.isWritable()) {
      return null;
    }

    const moduleBlocks = this.nodes
      .map(v => v.write());

    moduleBlocks.push(this.defaultNode.write());

    if (!moduleBlocks.length) {
      return null;
    }
    const imports = this.writeImportsLine();
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
    if (contents) {
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

    importsLine += ` from '${relativizeFileName(this.filename)}';`;

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

  isWritable () {
    return this.testCodeBlocks.length;
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
    // TODO: use constants for each of these tag names
    if (!data.unknown || !_.any(data.unknown, v => v.tagName === '@xBeforeEach')) {
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
    if (!data.unknown || !_.any(data.unknown, v => v.tagName === '@xAfterEach')) {
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
    const tmp = data.unknown
      .filter(v => v.tagName === '@xTestCase')
      .map(v => v.tagValue);

    return tmp;
  }

  static write(testCodeBlocks) {
    if (!testCodeBlocks.length) {
      return '';
    }

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

  isWritable () {
    return this.methods.length;
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
    if (node.isWritable()) {
      this.methods.push(node);
    }
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

  isWritable () {
    return this.testCodeBlocks.length;
  }

  write() {
    return TestWriter.write(this.testCodeBlocks);
  }
}

/**
 * @param results
 * @param config
 */
function publisher(results, config) {
  let currentFile = null;
  let currentClass = null;
  // start with an empty class
  //let currentGroup = new CurrentGroup();
  results.forEach(v => {
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
    }
  });

  currentFile.writeToFile();
}

function generateEsDoc () {
  del.sync(TEST_DIR);
  ESDoc.generate(ESDOC_CONFIG, publisher);
}

module.exports = generateEsDoc;

