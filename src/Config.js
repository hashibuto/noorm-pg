const fs = require('fs');
const path = require('path');

const CONN_URI_EVAL_MATCHER = /^({)(.*)(})$/;

class Config {
  /*
   * Initializes the Config module
   *
   * @param {string} configFile Full path to the configuration file (config.json)
   */
  static initialize(configFile) {
    Config.__data = JSON.parse(fs.readFileSync(configFile));
    if (!(Config.MAIN_KEY in Config.__data)) {
      throw new Error(`Could not locate configuration: "${Config.MAIN_KEY}" in ${configFile}`);
    }
  }

  /*
   * Returns a list of nodes belonging to a migrator group.
   *
   * @param {string} groupName The migrator group name
   * @returns Array
   */
  static getMigratorGroupNodes(groupName) {
    if (Config.__data === null)
      throw new Error('Config not initialized');

    for (let group of Config.__data[Config.MAIN_KEY].groups) {
      if (group.name === groupName) {
        return group.nodes.map(node => {
          return {
            ...node,
            connUri: Config.processConnURI(node.connUri)
          };
        });
      }
    }

    throw new Error('Migrator group by that name does not exist');
  }

 /**
  * Processes a connection URI, determines if contents are treated as a variable
  * or a literal.
  *
  * @param {any} connUri
  */
  static processConnURI(connUri) {
    const match = connUri.match(CONN_URI_EVAL_MATCHER);
    if (match === null)
      return connUri;

    return eval(match[2]);
  }
}
Config.MAIN_KEY = process.env.NODE_ENV === undefined ? 'development' : process.env.NODE_ENV;
Config.__data = null;

module.exports = Config;
