const POSITIONAL_BINDING_FINDER = /((?<!\$)\$\d+)/g;

/*
 * Represents a sub query intended for use in a bulk operation.
 */
class SubQuery {

  /*
   * Constructs a SubQuery object.  Bindings are referenced within the query using positional
   * 1 based binding tokens, ie. $1, $2, etc.
   *
   * @param {String} queryString - SQL query string
   * @param {Array} bindings - Array of binding arguments
   */
  constructor(queryString, bindings=null) {
    this.queryString = queryString;
    this.bindings = bindings;
  }

  /**
   * Returns a string indicating the namespaced instance type of this object.  This mitigates an
   * issue involving use of instanceof where multiple copies of noorm-pg exist.
   *
   * @returns
   * @memberof SubQuery
   */
  instanceof() {
    return SubQuery.INSTANCE_NAME;
  }

  /**
   * Returns true if obj is an instance of SubQuery.
   *
   * @param {*} obj
   * @memberof SubQuery
   */
  static isinstance(obj) {
    if (
      (obj !== undefined) &&
      (obj !== null) &&
      (obj.instanceof !== undefined) &&
      (typeof(obj.instanceof) === 'function')
    ) {
      return (obj.instanceof() === SubQuery.INSTANCE_NAME);
    }

    return false;
  }

  /*
   * Processes a sub query and returns a 2 piece array containing:
   * - The updated query string with binding tokens reflecting the greater location
   *   within the bulk operation
   * - The binding
   *
   * @param {number} bindingIndexOffset - The offset of the sub query bindings in the greater
   *   bulk query
   * @returns {Array} - A 2 piece array consisting of the updated query, and binding array.
   */
  process(bindingIndexOffset) {
    if (this.bindings !== null) {
      const bindQuery = this.queryString.replace(POSITIONAL_BINDING_FINDER, (match) => {
        const bindingIndex = parseInt(match.slice(1, match.length));
        return `$${bindingIndex + bindingIndexOffset}`;
      });

      return [
        bindQuery,
        this.bindings,
      ];
    }

    return [
      this.queryString,
      []
    ]
  }
}

SubQuery.INSTANCE_NAME = 'noorm-pg.SubQuery';

module.exports = SubQuery;
