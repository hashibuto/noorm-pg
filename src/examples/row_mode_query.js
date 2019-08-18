const Connection = require('../Connection');

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
      `).catch(e => {
        throw e;
      })

      const result = await conn.bulkQuery(
        `
          INSERT INTO job (name, type)
          :VALUES
          ON CONFLICT ON CONSTRAINT unique_job_name DO NOTHING
          RETURNING id, name, type
        `, [
          ['Police', 'Govt'],
          ['Fire fighter', 'Govt'],
          ['Chef', 'Food'],
          ['Programmer', 'Tech'],
          ['Data architect', 'Tech'],
        ],
        true
      ).catch(e => {
        throw e;
      });

      result.rows.forEach(row => {
        console.log(row);
      })
    } finally {
      conn.release();
    }
  }
}

new Example().run();
