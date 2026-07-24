const { Client } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

async function run() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const projectRef = supabaseUrl ? supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.(co|net)/)[1] : null;
  const host = projectRef ? `db.${projectRef}.supabase.co` : 'localhost';
  let password = process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD;

  if (!password) {
    console.error('No database password found in .env');
    return;
  }

  const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@${host}:5432/postgres`;
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to DB. Applying cascades...');

    const constraintsToDrop = [
      { table: 'payments', constraint: 'payments_lead_id_fkey' },
      { table: 'enrollments', constraint: 'enrollments_lead_id_fkey' },
      { table: 'meeting_outcomes', constraint: 'meeting_outcomes_lead_id_fkey' },
      { table: 'lead_objections', constraint: 'lead_objections_lead_id_fkey' },
      { table: 'campaigns_leads', constraint: 'campaigns_leads_lead_id_fkey' },
      { table: 'callback_requests', constraint: 'callback_requests_lead_id_fkey' },
      { table: 'meetings', constraint: 'meetings_lead_id_fkey' },
    ];

    for (const c of constraintsToDrop) {
      try {
        await client.query(`ALTER TABLE ${c.table} DROP CONSTRAINT IF EXISTS ${c.constraint};`);
      } catch (e) { }
    }

    const cascades = [
      `ALTER TABLE payments ADD CONSTRAINT payments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;`,
      `ALTER TABLE enrollments ADD CONSTRAINT enrollments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;`,
      `ALTER TABLE meeting_outcomes ADD CONSTRAINT meeting_outcomes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;`,
      `ALTER TABLE lead_objections ADD CONSTRAINT lead_objections_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;`,
      // meetings table needs it too
      `ALTER TABLE meetings ADD CONSTRAINT meetings_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;`,
      `DO $$ BEGIN
         IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'campaigns_leads') THEN
           ALTER TABLE campaigns_leads ADD CONSTRAINT campaigns_leads_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
         END IF;
       END $$;`,
      `DO $$ BEGIN
         IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'callback_requests') THEN
           ALTER TABLE callback_requests ADD CONSTRAINT callback_requests_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
         END IF;
       END $$;`
    ];

    for (const sql of cascades) {
      await client.query(sql);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS deleted_leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT,
        phone TEXT,
        sheet_row_index INTEGER,
        deleted_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_dl_email ON deleted_leads(email);
      CREATE INDEX IF NOT EXISTS idx_dl_phone ON deleted_leads(phone);
    `);

    console.log('✅ Success applying cascades and creating deleted_leads table.');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
