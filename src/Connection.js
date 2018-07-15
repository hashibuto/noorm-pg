const { Pool } = require('pg');
const types = require('pg').types

types.setTypeParser(20, function(val) {
  return parseInt(val)
})

// Regular expression which matches on binding parameter markers
// Had to remove in-quote detection because it was crashing the js engine
const BINDING_FINDER = /(:[a-zA-Z0-9_]+)/g;

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
   * @returns Promise
   * @memberof Connection
   */
  async query(queryString, bindings=null) {
    try {
      let promise = null;
      if (bindings !== null) {
        const matches = queryString.match(BINDING_FINDER);
        const data = matches.map(value => {
          const attrName = value.slice(1, value.length);
          return bindings[attrName];
        });
        let i = 0;
        const bindQuery = queryString.replace(BINDING_FINDER, () => {
          return `$${++i}`;
        });

        if (this.logging === true) {
          console.log(`Query:\n${bindQuery}\nBindings:\n${data}`);
        }

        promise = this.__conn.query(bindQuery, data);
      } else {
        if (this.logging === true) {
          console.log(`Query:\n${queryString}`);
        }
        promise = this.__conn.query(queryString);
      }

      return promise;
    } catch(e) {
      console.log(`Query:\n${queryString}`);
      console.log(`Bindings:\n${bindings}`);
      throw e;
    }
  }

  /*
   * Executes a query directly against the underlying pg connection object.
   * Does not perform any manipulation of binding parameters.
   *
   * @param {String} queryString SQL query string
   * @param {Array} Array of binding values, each will be assigned in order to
   *   markers in the queryString represented by $1, $2 etc. tokens
   */
  async rawQuery(queryString, bindings) {
    try {
      if (this.logging === true) {
        console.log(`Query:\n${queryString}\nBindings:\n${bindings}`);
      }

      return this.__conn.query(queryString, bindings);
    } catch(e) {
      console.log(`Query:\n${queryString}`);
      console.log(`Bindings:\n${bindings}`);
      throw e;
    }
  }
};

module.exports = Connection;
