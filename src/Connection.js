const { Pool } = require('pg');
const types = require('pg').types
const SubQuery = require('./SubQuery');
const assert = require('assert');

types.setTypeParser(20, function(val) {
  return parseInt(val)
})

// Regular expression which matches on binding parameter markers
// Had to remove in-quote detection because it was crashing the js engine
const BINDING_FINDER = /((?<!:):[a-zA-Z0-9_]+)/g;
const BULK_BINDING_FINDER = /((?<!:):VALUES)/g;

/**
 * Wraps the node-postgres to allow a few things such as transaction blocks and
 * named data binding parameters.
 *
 * @class Connection
 */
class Connection {

  constructor(connType, logging=false) {
    this.logging = logging;

    if (typeof connType === "string") {
      const pool = new Pool({
        connectionString: connType
      });

      this.__conn = pool;
    } else {
      this.__conn = connType;
    }
  }

  /**
   * Releases the underlying connection pool.  This shouldn't be called on transacted
   * Connection objects which use a single session as opposed to a pool.
   *
   * @memberof Connection
   */
  release() {
    this.__conn.end();
  }

  /**
   * Transacts any queries executed within callback.
   *
   * @param {function} callback Asynchronous method to be transacted.
   */
  async transact(callback) {
    const client = await this.__conn.connect();
    const conn = new Connection(client, this.logging);
    try {
      await conn.query("BEGIN");
      await callback(conn);
      await conn.query("COMMIT");
    } catch(e) {
      await conn.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Initiates a transaction and returns a Connection object
   * which wraps the transacted connection.
   *
   * @returns Connection
   * @memberof Connection
   */
  async begin() {
    const client = await this.__conn.connect();
    const conn = new Connection(client, this.logging);
    await conn.query("BEGIN");
    return conn;
  }

  /**
   * Commits transaction on transacted Connection object.
   *
   * @memberof Connection
   */
  async commit() {
    await this.__conn.query("COMMIT");
    this.__conn.release();
  }

  /**
   * Rolls back transaction on transacted Connection object.
   *
   * @memberof Connection
   */
  async rollback() {
    await this.__conn.query("ROLLBACK");
    this.__conn.release();
  }

  /**
   * Executes a single query against the database.  Binding parameters can be supplied
   * as a regular javascript object (kv pairs).
   *
   * @param {any} queryString SQL query string
   * @param {object} [bindings=null] Data binding object
   * @param {boolean} arrayRow - If true, rows will be returned as arrays instead of javascript
   *   objects.
   *
   * @returns Promise
   * @memberof Connection
   */
  query(queryString, bindings=null, arrayRow=false) {
    let queryObject;

    if (bindings !== null) {
      const matches = queryString.match(BINDING_FINDER);
      const data = [];
      const seenAttrs = new Set();
      matches.forEach(value => {
        const attrName = value.slice(1, value.length);
        if (!seenAttrs.has(attrName)) {
          data.push(bindings[attrName]);
          seenAttrs.add(attrName);
        }
      });
      let i = 0;
      const bindingOffset = {};
      const bindQuery = queryString.replace(BINDING_FINDER, (match) => {
        if (!(match in bindingOffset)) {
          bindingOffset[match] = ++i;
        }
        return `$${bindingOffset[match]}`;
      });

      queryObject = {
        text: bindQuery,
        values: data,
      };
    } else {
      if (this.logging === true) {
        console.log(`Query:\n${queryString}`);
      }
      queryObject = {
        text: queryString,
      };

      if (arrayRow === true) {
        queryObject.rowMode = 'array';
      }
    }

    return this.__conn.query(queryObject)
    .then(result => {
      if (this.logging === true) {
        console.log(`Query:\n${queryObject.text}`);
        if (queryObject.values !== undefined) {
          console.log(`Bindings:\n${queryObject.values}`);
        }
      }

      return result;
    })
    .catch(e => {
      console.log(`Query:\n${queryObject.text}`);
      if (queryObject.values !== undefined) {
        console.log(`Bindings:\n${queryObject.values}`);
      }
      throw e;
    });
  }

  /*
   * Executes a query directly against the underlying pg connection object.
   * Does not perform any manipulation of binding parameters.
   *
   * @param {String} queryString SQL query string
   * @param {Array} Array of binding values, each will be assigned in order to
   *   markers in the queryString represented by $1, $2 etc. tokens
   * @param {boolean} arrayRow - If true, rows will be returned as arrays instead of javascript
   *   objects.
   */
  rawQuery(queryString, bindings, arrayRow=false) {
    const queryObject = {
      text: queryString,
      values: bindings
    };

    if (arrayRow === true) {
      queryObject.rowMode = 'array';
    }

    return this.__conn.query(queryObject)
    .then(result => {
      if (this.logging === true) {
        console.log(`Query:\n${queryString}\nBindings:\n${bindings}`);
      }
      return result;
    })
    .catch(e => {
      console.log(`Query:\n${queryString}`);
      console.log(`Bindings:\n${bindings}`);
      throw e;
    });
  }

  /*
   * Used to perform a bulk insert or update operation.  Accepts bindings as an array of arrays,
   * whereby the inner array corresponds to a group of VALUES.
   *
   * Example query string:
   *
   *  INSERT INTO table
   *  (col1, col2, col3)
   *  :VALUES
   *  ON CONFLICT x DO NOTHING;
   *
   * Supplied bindings will replace :VALUES.  Should a portion of the VALUES be dependent
   * on a subquery as opposed to a simple binding, the SubQuery object should be supplied
   * in lieu of a piece of binding data.  For example:
   *
   * const bindings = [
   *   ['a', 'b', new SubQuery('SELECT value FROM other_table WHERE id = $1', ['c'])],
   *   ['d', 'e', new SubQuery('SELECT value FROM other_table WHERE id = $1', ['f'])],
   * ]
   *
   * @param {String} queryString SQL query string
   * @param {Array} Array of binding arrays.
   * @param {boolean} arrayRow - If true, rows will be returned as arrays instead of javascript objects.
   * @param {number} rowChunkSize - The maximum number of rows to include per statement.  This will cause
   *   the query to be broken up into multiple queries if the row count exceeds this number.  Data being
   *   returned in any of the queries will be concatenated into a single array and returned.
   *
   */
  async bulkQuery(queryString, bindings, rowChunkSize=10000, arrayRow=false) {
    assert(Array.isArray(bindings), "Bindings must be an array type");
    assert(bindings.length > 0, "No bindings supplied to query");

    let firstResult = null;
    let resultRows = [];
    let result;
    for (let i = 0; i < bindings.length; i += 1000) {
      const subBindings = bindings.slice(i, i+1000);
      if (subBindings.length > 0) {
        let bindingArray = [];
        const values = [];
        subBindings.forEach(bindingRow => {
          const rowValues = [];
          bindingRow.forEach(bindingCol => {
            if (SubQuery.isinstance(bindingCol)) {
              // Process the subquery
              const [ subQueryString, bindings ] = bindingCol.process(bindingArray.length);
              bindingArray = [...bindingArray, ...bindings];
              rowValues.push(`(${subQueryString})`);
            } else {
              bindingArray.push(bindingCol);
              rowValues.push(`$${bindingArray.length}`);
            }
          })
          values.push(`(${rowValues.join(',')})`)
        })

        const matches = queryString.match(BULK_BINDING_FINDER);
        assert(matches !== null, "Missing :VALUES token");
        assert(matches.length === 1, "Query must contain exactly one :VALUES token");
        const bindQuery = queryString.replace(BULK_BINDING_FINDER, (match) => {
          return `VALUES\n${values.join(',\n')}`;
        });

        const queryObject = {
          text: bindQuery,
          values: bindingArray
        };

        if (arrayRow === true) {
          queryObject.rowMode = 'array';
        }

        result = await this.__conn.query(queryObject)
        .then(result => {
          if (this.logging === true) {
            console.log(`Query:\n${queryString}\nBindings:\n${bindings}`);
          }
          return result;
        })
        .catch(e => {
          console.log(`Query:\n${bindQuery}`);
          console.log(`Bindings:\n${bindingArray}`);
          throw e;
        });

        if (firstResult === null) {
          firstResult = result;
        }

        resultRows = [
          ...resultRows,
          result.rows,
        ]
      }
    }

    firstResult.rows = resultRows;
    return firstResult;
  }
};

module.exports = Connection;
