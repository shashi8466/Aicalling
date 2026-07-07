require('dotenv').config();
const { Client } = require('pg');
const readline = require('readline');

async function promptPassword() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question('Please enter your Supabase Database Password: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function run() {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.error('❌ SUPABASE_URL is not defined in .env');
    process.exit(1);
  }
  const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.(co|net)/);
  if (!match) {
    console.error('❌ Could not parse project reference.');
    process.exit(1);
  }
  const host = `db.${match[1]}.supabase.co`;
  let password = process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD;
  if (!password) {
    password = await promptPassword();
  }

  const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@${host}:5432/postgres`;
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    console.log('✅ Connected to database.');

    const sql = `
      ALTER TABLE leads 
      ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS country TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS state TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS time_zone TEXT DEFAULT 'America/New_York',
      ADD COLUMN IF NOT EXISTS last_morning_call TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_evening_call TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS next_scheduled_call TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS meeting_status TEXT DEFAULT 'Not Booked';
    `;
    await client.query(sql);
    console.log('✅ Columns added successfully to leads table.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

run();
