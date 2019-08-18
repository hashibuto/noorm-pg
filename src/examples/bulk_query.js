const Connection = require('../Connection');
const SubQuery = require('../SubQuery');

class Example {
  async run() {
    // postgresql://{host}:{port}/{database}
    const connString = process.env.CONN_STRING;

    const conn = new Connection(connString, true);
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS job (
          id BIGSERIAL NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          CONSTRAINT pk_job PRIMARY KEY (id),
          CONSTRAINT unique_job_name UNIQUE(name)
        );

        CREATE TABLE IF NOT EXISTS person (
          id BIGSERIAL NOT NULL,
          job_id BIGINT REFERENCES job (id),
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          CONSTRAINT pk_person PRIMARY KEY (id),
          CONSTRAINT unique_name UNIQUE(first_name, last_name)
        );
      `);

      await conn.bulkQuery(
        `
          INSERT INTO job (name, type)
          :VALUES
          ON CONFLICT ON CONSTRAINT unique_job_name DO NOTHING
        `, [
          ['Police', 'Govt'],
          ['Fire fighter', 'Govt'],
          ['Chef', 'Food'],
          ['Programmer', 'Tech'],
          ['Data architect', 'Tech'],
        ]
      );

      await conn.bulkQuery(
        `
          INSERT INTO person (
            job_id,
            first_name,
            last_name
          ) :VALUES
          ON CONFLICT ON CONSTRAINT unique_name DO NOTHING
        `,
        [
          [
            new SubQuery("SELECT id FROM job WHERE name = $1", ['Chef']),
            'Gordon',
            'Ramsey',
          ],
          [
            new SubQuery("SELECT id FROM job WHERE name = $1", ['Programmer']),
            'Cow',
            'Man',
          ],
          [
            null,
            'Jobless',
            'Person',
          ]
        ]
      );
    } finally {
      conn.release();
    }
  }
}

new Example().run();
