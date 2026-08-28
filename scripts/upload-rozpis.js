#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Chybí SUPABASE_URL nebo SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadRozpis() {
  try {
    console.log('Čtení seed souboru...');
    const seedPath = path.join(__dirname, '../supabase/seed/rozpis-srpen-zari.sql');
    const sql = fs.readFileSync(seedPath, 'utf8');

    console.log('Spouštění SQL...');
    const { error } = await supabase.rpc('sql_exec', { statement: sql });

    if (error) {
      console.error('Chyba:', error);
      process.exit(1);
    }

    console.log('✓ Data nahrána úspěšně');
  } catch (err) {
    console.error('Chyba:', err);
    process.exit(1);
  }
}

uploadRozpis();
