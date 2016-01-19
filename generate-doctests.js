/**
 * TODO: clear tests folder on each run
 */
const beautify = require('js-beautify').js_beautify;
const fs = require('fs');
const parse = require('jsdoc-parse');

parseStream = parse({
  conf: 'jsdoc-parser-config.json',
  src: [ '*.js' ]
});

parseStream.on('data', function () {
  var results = Array.prototype.slice.apply(arguments);
  results.forEach(innerArray => {
    JSON.parse(innerArray).forEach(v => makeTestFile(v))
  });
});

function constructFilename(testData) {
  return `tests/unit/${testData.meta.filename}:${testData.name}:${testData.kind}.test.js`;
}

function constructModuleName(testData) {
  return `${testData.meta.filename}:${testData.name}:${testData.kind}.test.js`;
}

function constructTestLabel(testData) {
  return `${testData.kind} ${testData.name} ${testData.meta.filename}:${testData.meta.lineno}`;
}

function makeTestFile(testData) {
  console.log('testData', testData);
  if (!testData.examples) {
    return;
  }

  // TODO: add import here
  fs.writeFileSync(`${constructFilename(testData)}`, constructFileCode(testData), {
    indent_size: 2
  });
}

function constructFileCode(testData) {
  var ret;
  if (testData.id === 'module.exports') {
    ret = `import default from '${testData.meta.filename}'\n\n`;
  } else if (testData.memberof) {
    ret = `import {${testData.memberof}} from '${testData.meta.filename}'\n\n`;
  } else {
    ret = `import {${testData.name}} from '${testData.meta.filename}'\n\n`;
  }

  ret += `describe('${constructModuleName(testData)}', () => {
    ${testData.examples.map(code => {
    return `it('${constructTestLabel(testData)}', () => {
        ${code}
      });`;
  }).join("\n\n")}
  });`;

  return beautify(ret);
}