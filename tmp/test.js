export class TestFactory {
  /**
   * @defaultExport TestFactory
   * @xTestCase
   * assert.ok(TestFactory.test(structure));
   */
  test() {

  }
}

/**
 * @example
 * asdf
 */
function testWtf() {

}
var test = TestFactory({
    a: 1,
    b: 'foo'
});
test.update({
    a: 2
});
test.a;
test.b;
