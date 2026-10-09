// GIGO P1/P2 business facts: schemas, validators, readers, read-only tools.
// See docs/specs/gigo-p1-p2-facts.md.

module.exports = {
  ...require('./factValidate'),
  ...require('./factSchema'),
  ...require('./factReaders'),
  ...require('./factTools'),
};
