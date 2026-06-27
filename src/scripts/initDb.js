/**
 * Database Initialization Script
 * Runs schema.sql and schema_auth.sql directly on Supabase PostgreSQL.
 * Run: node src/scripts/initDb.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Client } = require('pg');

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
  console.log('\n══════════════════════════════════════════════════');
  console.log('  Supabase Schema Initialization');
  console.log('══════════════════════════════════════════════════\n');

  // 1. Get database details
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.error('❌ SUPABASE_URL is not defined in your .env file.');
    process.exit(1);
  }

  // Extract project ref from url: https://<ref>.supabase.co
  const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.(co|net)/);
  if (!match) {
    console.error('❌ Could not extract Supabase project reference from SUPABASE_URL.');
    process.exit(1);
  }
  const projectRef = match[1];
  const host = `db.${projectRef}.supabase.co`;

  let password = process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD;
  if (!password) {
    console.log(`Your Supabase host is: ${host}`);
    console.log(`Default database user: postgres\n`);
    password = await promptPassword();
  }

  if (!password) {
    console.error('❌ Database password is required.');
    process.exit(1);
  }

  const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@${host}:5432/postgres`;
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false } // Required for Supabase external connections
  });

  try {
    console.log('🔄 Connecting to Supabase PostgreSQL database...');
    await client.connect();
    console.log('✅ Connected successfully.\n');

    // 2. Read schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    // Check in both ../../supabase/schema.sql and ../../supabase directory
    let resolvedSchemaPath = path.join(__dirname, '../../supabase/schema.sql');
    if (!fs.existsSync(resolvedSchemaPath)) {
      resolvedSchemaPath = path.join(__dirname, '../supabase/schema.sql');
    }
    
    if (!fs.existsSync(resolvedSchemaPath)) {
      throw new Error(`schema.sql not found at ${resolvedSchemaPath}`);
    }
    console.log('🔄 Executing schema.sql...');
    const schemaSql = fs.readFileSync(resolvedSchemaPath, 'utf8');
    await client.query(schemaSql);
    console.log('✅ schema.sql executed successfully.\n');

    // 3. Read schema_auth.sql
    let resolvedSchemaAuthPath = path.join(__dirname, '../../supabase/schema_auth.sql');
    if (!fs.existsSync(resolvedSchemaAuthPath)) {
      resolvedSchemaAuthPath = path.join(__dirname, '../supabase/schema_auth.sql');
    }
    
    if (!fs.existsSync(resolvedSchemaAuthPath)) {
      throw new Error(`schema_auth.sql not found at ${resolvedSchemaAuthPath}`);
    }
    console.log('🔄 Executing schema_auth.sql...');
    const schemaAuthSql = fs.readFileSync(resolvedSchemaAuthPath, 'utf8');
    await client.query(schemaAuthSql);
    console.log('✅ schema_auth.sql executed successfully.\n');

    console.log('🎉 Database initialization complete!');
  } catch (err) {
    console.error(`\n❌ Error initializing database: ${err.message}`);
    console.error('Make sure your password is correct and your database is active.');
  } finally {
    await client.end();
  }
}

run();
