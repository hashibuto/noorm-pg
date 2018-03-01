# noorm-pg

> Migrators (mutli-database, multi-node), transaction blocks, and data binding for PostgreSQL for those who don't like using an ORM.

## Install

Package local install (won't deploy migrator script).
```bash
npm install --save noorm-pg
```

In order to deploy the migrator script, a global install is also required.
```bash
npm install --global noorm-pg
```

## Migrations
The migrator supports migration groups, each of which can reference multiple nodes (databases following the same schema).  This is useful in scenarios where a given database is being scaled horizontally to multiple nodes.  The basic usage is as follows:

####Initialization

From the target package root (where name is the name of the first migration group you'd like to create):
```bash
migdb db:init [name]
```
This will build the basic directory structure and initialize a `migrations/config.json` in the package root.  Each invocation of this command will create a new migration group.

A basic, single database structure with multiple nodes would look like this:

```
{
  "development": {
    "groups": [
      {
        "name": "customer_db",
        "nodes": [
          {
            "alias": "default",
            "connUri": "postgresql://username:password@localhost:5432/customer_db"
          }
        ]
      }
    ]
  },
  "production": {
    "groups": [
      {
        "name": "customer_db",
        "nodes": [
          {
            "alias": "customer_db_1",
            "connUri": "postgresql://username:password@node1.production/customer_db"
          },
          {
            "alias": "customer_db_2",
            "connUri": "postgresql://username:password@node2.production/customer_db"
          },
          {
            "alias": "customer_db_3",
            "connUri": "postgresql://username:password@node3.production/customer_db"
          }
        ]
      }
    ]
  }
}
```
It is recommended that you do not store your connection URIs in the config file but instead use `process.env` and reference it as follows:

```
{
  ...
  "connUri": "{process.env.PROD_DB_NODE_1}"
}
```
This will be evaluated as a variable by the `migdb` script instead of a string literal.

It is important to note that `migdb` will look at `process.env.NODE_ENV` when determining which branch (production, development, etc.) to access when running migrations.  If `process.env.NODE_ENV` is not undefined, `migdb` will default to `development`.
#### Creating a migration script

```bash
migdb db:migration:create [name]
```
This will add a .js migration script file to the migrator group indicated by `name` which will have the following structure:
```
module.exports = {
  upgrade: async (conn) => {
    // Migration code goes in here
  },
  downgrade: async (conn) => {
    // De-migration code goes in here
  },
  transactUpgrade: true,
  transactDowngrade: true
};
```
The connection object will be discussed below.  There is an upgrade function, a downgrade function, and two booleans, indicating whether or not each function is to be wrapped in a transaction.

**NOTE:** `migdb` will attempt to transact the entire migration/rollback process.  It is sometimes however necessary to execute some SQL without a transaction.  In this event, the transaction will be committed, the untransacted migrator will run, then a new transaction will begin for any further pending migration scripts.  It is highly recommended that any untransacted statements are executed in isolation within their own migrator script to avoid issues in the event of any failure to execute all statements within the migrator.

####Running migrator(s)

```bash
migdb db:migrate [name]
```
Executes pending migrations in one or more migrator groups. `name` is an optional argument to limit the scope of the migration to that single migrator group.  If `name` is not provided, all pending migrations on all migrator groups will be executed.  At this time, migrations are executed synchronously.  As mentioned above, all pending transacted migrators will run prior to committing the transaction, thus if any failure, all will be rolled back.

####Rolling back migrations

```bash
migdb db:migrate:undo [name] [version]
```
Executes a rollback up to (but not including) migrator `version`, which is the full file name of the migrator file, including the `.js` extension.  Implicitly, this means that the very first migrator cannot be rolled back.  The philosophy here is that one could simply drop and recreate the database in this event, as opposed to executing the rollback.  There is no notion of rolling back a single migration (without naming) since in a node cluster scenario, it's impossible to guarantee that all nodes are on the same migration, thus providing the name is necessary.

## Connection object

####Initialization and teardown

```js
const conn = new Connection('postgresql://localhost/mydb');
conn.release();
```
The `Connection` object utilizes a connection pool, provided by the underlying `node-pg` module.  The `release` method releases the connection pool back to the database.  See the PostgreSQL documentation on [connection strings](https://www.postgresql.org/docs/9.4/static/libpq-connect.html#LIBPQ-CONNSTRING) for detailed examples of a connection URI.

####Querying

```js
const results = await conn.query("SELECT field FROM table WHERE x = 1");
results.rows.forEach(row => {
	console.log(row.field);
});
```
`query` is an async function so it can be used with the `await` keyword to control flow.

####Data binding

```js
const results = await conn.query(`
	SELECT first_name, last_name FROM table
	WHERE
		age > :age AND
		title = :jobTitle
`,
{
	age: 30,
	jobTitle: 'decorator'
});
```
Bound data takes the form of a regular javascript object.  Single binding object per query.

####Transaction blocks

```js
await conn.transact(async t => {
	await t.query(
		"INSERT INTO table (x, y, z) VALUES (:one, :two, :three)",
		{
			one: 33,
			two: 66,
			three: 'abc'
		}
	);
	await t.query(
		"SELECT * FROM table"
	);
});
```
Transaction block accept a callback function which receives a `Connection` object as the argument.  The underlying connection is a single connection from the pool of the `Connection` object which initiated the transaction.

That's all folks.
