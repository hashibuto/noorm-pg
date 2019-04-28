#!/usr/bin/env node
let envPath = null;
const newArgs = [];
const removeInds = new Set();
process.argv.forEach((arg, index) => {
  if (arg === '--envdir') {
    envPath = process.argv[index + 1];

    removeInds.add(index);
    removeInds.add(index + 1);
  } else {
    if (!removeInds.has(index)) {
      newArgs.push(arg);
    }
  }
});
process.argv = newArgs;

const path = require('path');
const fs = require('fs');
const Connection = require('../Connection');
const Config = require('../Config');
const glob = require('glob');

const COMMANDS = new Set([
  "db:init",
  "db:migration:create",
  "db:migrate",
  "db:migrate:undo"
]);

const INIT_CONFIG = {
  development: {
    groups: [
    ]
  },
  production: {
    groups: [
    ]
  }
};

const TABLE_NAME = "migrate_meta";

/**
 * Pads number with leading zeros up to length.
 *
 * @param {any} number Number to pad.
 * @param {any} length Total length of number after padding.
 * @returns
 */
function padLeadingZeros(number, length) {
  const numStr = `${number}`;
  if (numStr.length === length)
    return numStr;

  const zeroArray = new Array(length - numStr.length);
  zeroArray.fill('0');
  return `${zeroArray.join('')}${numStr}`;
}
/**
 * Verifies the environment and returns the section of the config.json
 * pertaining to the current process.env.APP_ENV.  If any problem, nul
 * is returned.
 *
 */
function verifyEnvironment() {
  const configFile = path.join('.', 'migrators', 'config.json');
  if (!fs.existsSync(configFile)) {
    console.log("config.json could not be located, make sure you have initialized the environment.")
    return null;
  }

  let nodeEnv = process.env.APP_ENV;
  if (nodeEnv === undefined) {
    console.log("process.env.APP_ENV is undefined, using development configuration");
    nodeEnv = "development";
  }

  const config = JSON.parse(fs.readFileSync(configFile));
  if (!(nodeEnv in config)) {
    console.log(`There is no configuration for "${nodeEnv}" in config.json, feel free to add one or modify process.env.APP_ENV`);
    return null;
  }

  return config[nodeEnv];
}

/**
 * Initializes the migrator structure within the package and adds a migrator group.
 *
 * @param {string} name Name of the migrator group to create.
 */
function dbInit(name) {
  if (!fs.existsSync(path.join('.', 'migrators'))) {
    fs.mkdirSync("migrators");
  }

  const configFile = path.join('.', 'migrators', 'config.json');

  let config = {...INIT_CONFIG};
  if (fs.existsSync(configFile)) {
    config = JSON.parse(fs.readFileSync(configFile));
  }

  let found = false;
  Object.keys(config).forEach(key => {
    const groups = config[key].groups;
    groups.forEach(group => {
      if (group.name === name)
        found = true;
    });

    if (found === false) {
      groups.push(
        {
          name,
          nodes: []
        }
      )

    }
  });

  if (!fs.existsSync(path.join('.', 'migrators', name))) {
    fs.mkdirSync(path.join('.', 'migrators', name));
  }
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.log(`Migrator group "${name}" initialized.`)
  console.log(`Add connection URIs to:\n  ${configFile}`)
}
/**
 * Queries for the existance of the metadata table and returns a bool
 * indicating whether or not it exists.
 *
 * @param {Connection} conn Connection object.
 * @returns Bool indicating if table exists.
 */
async function metaTableExists(conn) {
  const result = await conn.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class
      WHERE
        relname = '${TABLE_NAME}' AND
        relkind = 'r'
    ) AS exists
  `);
  return result.rows[0].exists;
}

/**
 * Creates migrator in migration group.
 *
 * @param {string} name Migrator group name in which to create the migrator script.
 */
function createMigrator(name) {
  const templatePath = path.join(__dirname, '__template.js');
  const templateData = fs.readFileSync(templatePath);

  const d = new Date();
  const year = d.getFullYear();
  const month = padLeadingZeros(d.getMonth() + 1, 2);
  const day = padLeadingZeros(d.getDate(), 2);
  const hour = padLeadingZeros(d.getHours(), 2);
  const minute = padLeadingZeros(d.getMinutes(), 2);
  const second = padLeadingZeros(d.getSeconds(), 2);
  const milisecond = padLeadingZeros(d.getMilliseconds(), 3);
  const dateString = `${year}${month}${day}${hour}${minute}${second}${milisecond}`;
  const migratorFile = path.join('.', 'migrators', name, `${dateString}-new_migrator.js`);
  fs.writeFileSync(migratorFile, templateData);
  console.log(`Created:\n  ${migratorFile}`);
}

/*
 * @param {string} connUri PostgreSQL connection URI.
 * @param {int} [waitTime=0] Number of seconds to wait in event of the database not being ready
 */
async function getConn(connUri, waitTime) {
  console.log(`Trying ${connUri}`)
  const startTime = new Date();

  let c = null;
  let totalSec = 0;

  while (c === null) {
    c = await new Promise(async (resolve, reject) => {
      let conn;
      try {
        conn = new Connection(connUri);

        if (conn.__conn !== undefined) {
          // Perform a basic query against the database to ensure connectivity
          const result = await conn.query("SELECT 1");
          resolve(conn);
        } else {
          const t = new Date();
          totalSec = (t.getTime() - startTime.getTime()) / 1000;
          if (totalSec + 1 > waitTime) {
            resolve(null)
          } else {
            setTimeout(() => {
              console.log("Waiting for connection to become available");
              console.log(connUri)
              resolve(null)
            }, 1000)
          }
        }

      } catch(e) {
        setTimeout(() => {
          console.log("Waiting for connection to become available")
          console.log(connUri)
          reject(e)
        }, 1000)
      }
    })
    .catch(e => {
      // Blanket catch here, we know there's a connection issue
      return null;
    })

    const t = new Date();
    totalSec = (t.getTime() - startTime.getTime()) / 1000;
    if (totalSec > waitTime)
      break;
  }

  return c;
}


/**
 * Upgrades the schema.
 *
 * @param {string} migGroupDir Migrator group directory.
 * @param {string} connUri PostgreSQL connection URI.
 * @param {int} [waitTime=0] Number of seconds to wait in event of the database not being ready
 */
async function upgradeSchema(migGroupDir, connUri, waitTime) {
  console.log("Running in upgrade mode");
  const conn = await getConn(connUri, waitTime);
  if (conn === null) {
    console.log("Error establishing connection to database");
    process.exit(1);
  }

  try {
    if (!(await metaTableExists(conn))) {
      // Add the table
      console.log("Creating migrator metadata table");
      await conn.transact(async t => {
        await t.query(`
          CREATE TABLE ${TABLE_NAME} (
            version TEXT PRIMARY KEY
          )
        `)
      });
    }

    const latest = await conn.query(`
      SELECT MAX(version) AS version FROM migrate_meta;
    `)
    .then(results => {
      return results.rows[0].version;
    });

    const files = await new Promise((resolve, reject) => {
      glob(`${migGroupDir}/*.js`, (err, matches) => {
        resolve(matches.map(match => {
          return path.basename(match)
        }).sort());
      });
    })

    let upgrade, transactUpgrade = null;
    if (files.length > 0) {
      if (files[files.length - 1] === latest) {
        console.log("Already up to date.");
      }
    } else if (files.length === 0) {
      console.log("No migrators defined.");
    }

    while (files.length > 0) {
      let file = files.shift();
      if (latest === null || file > latest) {
        let { upgrade, transactUpgrade} = require(path.resolve(migGroupDir, file));
        if (transactUpgrade) {
          await conn.transact(async t => {
            while ((file !== null || files.length > 0) && transactUpgrade === true) {
              console.log(`Migrating: ${file}`);
              await upgrade(t);
              await t.query(`
                INSERT INTO ${TABLE_NAME} (
                  version
                ) VALUES (
                  :value
                )
              `,
              {
                value: file
              });

              if (files.length > 0) {
                file = files.shift();
                const r = require(path.resolve(migGroupDir, file));
                upgrade = r.upgrade;
                transactUpgrade = r.transactUpgrade;
              } else {
                file = null;
              }
            }
          });
        }
        if (file !== null) {
          console.log(`Migrating: ${file}`);
          await upgrade(conn);
          await conn.query(`
            INSERT INTO ${TABLE_NAME} (
              version
            ) VALUES (
              :value
            )
          `,
          {
            value: file
          });
        }
      }
    }
  }
  finally {
    conn.release();
  }
}
/**
 * Downgrades schema.
 *
 * @param {string} migGroupDir Migration group directory.
 * @param {string} connUri PostgreSQL connection URI.
 * @param {string} version Migrator version to migrate down towards (non-inclusive).
 * @returns
 */
async function downgradeSchema(migGroupDir, connUri, version) {
  console.log("Running in downgrade mode");
  const conn = new Connection(connUri);
  if (conn.__conn === undefined) {
    console.log("Error establishing connection to database");
    process.exit(1);
  }
  try {
    // Make sure the table exists
    if (!(await metaTableExists(conn))) {
      console.log("Migrator table not initialized, backing out.");
      return;
    }

    // Verify the migrator exists
    const files = await new Promise((resolve, reject) => {
      glob(`${migGroupDir}/${version}`, (err, matches) => {
        resolve(matches.map(match => {
          return path.basename(match)
        }));
      });
    })

    if (files.length === 0) {
      console.log("No migrator exists by that name");
      return;
    }

    // Make sure the version is in the database.
    const versions = (await conn.query(`
      SELECT version FROM ${TABLE_NAME}
      WHERE version > :specified
      ORDER BY version DESC;
    `,
    {
      specified: version
    })).rows.map(row => {
      return row.version;
    });

    if (versions.length === 0) {
      console.log("Nothing to do");
      return;
    }

    let upgrade, transactUpgrade = null;
    while (versions.length > 0) {
      let v = versions.shift();
      let { downgrade, transactDowngrade} = require(path.resolve(migGroupDir, v));
      if (transactDowngrade) {
        await conn.transact(async t => {
          while ((v !== null || versions.length > 0) && transactDowngrade === true) {
            console.log(`Rolling back: ${v}`);
            await downgrade(t);
            await t.query(`
              DELETE FROM ${TABLE_NAME}
              WHERE version = :version
            `,
            {
              version: v
            });
            console.log(v)

            if (versions.length > 0) {
              v = versions.shift();
              const r = require(path.resolve(migGroupDir, v));
              downgrade = r.downgrade;
              transactDowngrade = r.transactDowngrade;
            } else {
              v = null;
            }
          }
        });
      }
      if (v !== null) {
        console.log(`Rolling back: ${v}`);
        await downgrade(conn);
        await conn.query(`
        DELETE FROM ${TABLE_NAME}
        WHERE version = :version;
        `,
        {
          version: v
        });
      }
    }
  }
  finally {
    conn.release();
  }
}

/**
 * Executes migration script in all groups unless group name is provided.
 *
 * @param {string} [name=null] Migrator group name.
 * @param {int} [waitTime=0] Number of seconds to wait in event of the database not being ready
 */
async function doMigration(name=null, waitTime=0) {
  const config = verifyEnvironment();
  if (config === null)
    return;

  for (let group of config.groups) {
    if (group.name === name || name === null) {
      const groupDir = path.join('.', 'migrators', group.name);
      for (let node of group.nodes) {
        console.log(`Checking ${group.name}, node: ${node.alias}`);
        await upgradeSchema(groupDir, Config.processConnURI(node.connUri), waitTime);
      }
    }
  }
}
/**
 * Rolls back database group (by name) to specified version.  Single rollbacks were
 * not chosen since there was a potential for different databases within the cluster
 * to be at different versions.
 *
 * @param {string} name
 * @param {string} version
 */
async function doRollback(name, version) {
  const config = verifyEnvironment();
  if (config === null)
    return;

  for (let group of config.groups) {
    if (group.name === name || name === null) {
      const groupDir = path.join('.', 'migrators', group.name);
      for (let node of group.nodes) {
        console.log(`Checking ${group.name}, node: ${node.alias}`)
        await downgradeSchema(groupDir, Config.processConnURI(node.connUri), version);
      }
    }
  }
}

/**
 * Processes command line arguments and executes appropriate function or displays help.
 *
 */
function processArgs() {
  let command = null;
  const argv = process.argv;
  if (argv.length >= 3 && COMMANDS.has(argv[2])) {
    command = argv[2];

    switch(command) {
      case "db:init": {
        if (argv.length !== 4) {
          console.log("Must specify migrator group name to create.");
          break;
        }
        dbInit(argv[3]);
        break;
      }
      case "db:migration:create": {
        if (argv.length !== 4) {
          console.log("Must specify migrator group name.");
          break;
        }
        createMigrator(argv[3]);
        break;
      }
      case "db:migrate": {
        let name = null;
        let waitTime = 0;
        if (argv.length >= 4) {
          if (!argv[3].startsWith('--'))
            name = argv[3];
        }

        let parseError = false;
        argv.forEach((arg, index) => {
          if (arg === '--wait') {
            if (argv.length <= index + 1) {
              parseError = true;
              console.log("Must specify number of seconds to wait");
            } else {
              waitTime = parseInt(argv[index+1]);
              if (isNaN(waitTime) || waitTime <= 0) {
                parseError = true;
                console.log("Wait time must be a positive integer");
              }
            }
          }
        })
        if (!parseError)
          doMigration(name, waitTime);
        break;
      }
      case "db:migrate:undo": {
        if (argv.length !== 5) {
          console.log("Must specify migrator group name and version.");
          break;
        }
        doRollback(argv[3], argv[4]);
        break;
      }
    }
  }

  if (command === null) {
    console.log("Migrate one or more PostgreSQL databases");
    console.log("");
    console.log("Usage:");
    console.log("migrate [command] [options]");
    console.log("");
    console.log("Global options:");
    console.log("");
    console.log("  --envdir                           Specifies a directory where .env.json files can be found");
    console.log("");
    console.log("Valid commands:");
    console.log("");
    console.log("  db:init [name]                     Creates a named migrator group");
    console.log("  db:migration:create [name]         Creates a new migrator for the named migrator group");
    console.log("  db:migrate [name] [--wait n]       Runs all migrators (optional database name)");
    console.log("                                     (--wait will wait up to n seconds for the database to become available)");
    console.log("  db:migrate:undo [name] [version]   Rolls back migrator to specific version");
  }
}

if (fs.existsSync(path.join('.', 'package.json')) === false) {
  console.log("package.json not found");
  console.log("migdb must be run from the package root");
} else {
  processArgs();
}
