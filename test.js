/**
 * @example
 * TestFactory(structure);
 */
function TestFactory(structure) {
    return null;
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
