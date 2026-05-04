// Prisma schema → DB drift report. Lists missing columns per existing table.
// Does NOT alter the DB; emits ALTER statements you can review and run.
const fs = require('fs');
const path = require('path');
const m = require('mariadb');

const PRISMA_TYPE_TO_MYSQL = {
  String: 'VARCHAR(191)',
  Boolean: 'TINYINT(1)',
  Int: 'INT',
  BigInt: 'BIGINT',
  Float: 'DOUBLE',
  DateTime: 'DATETIME(3)',
  Decimal: 'DECIMAL(10,2)',
};

function parseSchema(text) {
  const models = {};
  const re = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let mm;
  while ((mm = re.exec(text))) {
    const name = mm[1];
    const body = mm[2];
    const fields = [];
    body.split('\n').forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('@@')) return;
      const fm = t.match(/^(\w+)\s+([\w\?]+)(\[\])?\s*(.*)$/);
      if (!fm) return;
      const fieldName = fm[1];
      let type = fm[2].replace('?', '');
      const isList = !!fm[3];
      const isOptional = fm[2].endsWith('?');
      const rest = fm[4] || '';
      // Skip relation fields (don't have a DB column directly)
      if (rest.includes('@relation')) return;
      // Skip pure model references (lists or types not scalar)
      if (isList) return;
      if (!PRISMA_TYPE_TO_MYSQL[type]) return; // model relation field
      // Extract @db.* override
      let mysqlType = PRISMA_TYPE_TO_MYSQL[type];
      const dbMatch = rest.match(/@db\.(\w+)(?:\(([^)]+)\))?/);
      if (dbMatch) {
        const dbType = dbMatch[1];
        const args = dbMatch[2];
        if (dbType === 'VarChar' && args) mysqlType = `VARCHAR(${args})`;
        else if (dbType === 'Text') mysqlType = 'TEXT';
        else if (dbType === 'Date') mysqlType = 'DATE';
        else if (dbType === 'Decimal' && args) mysqlType = `DECIMAL(${args})`;
      }
      const hasDefault = /@default\(([^)]+)\)/.exec(rest);
      let defaultClause = '';
      if (hasDefault) {
        const v = hasDefault[1].trim();
        if (v === 'now()') defaultClause = ' DEFAULT CURRENT_TIMESTAMP(3)';
        else if (v === 'true') defaultClause = ' DEFAULT 1';
        else if (v === 'false') defaultClause = ' DEFAULT 0';
        else if (/^\d+$/.test(v)) defaultClause = ` DEFAULT ${v}`;
        else if (/^-?\d*\.?\d+$/.test(v)) defaultClause = ` DEFAULT ${v}`;
        else if (v.startsWith('"') || v.startsWith("'")) defaultClause = ` DEFAULT ${v.replace(/"/g, "'")}`;
        else if (v === 'autoincrement()') defaultClause = ' AUTO_INCREMENT';
        else if (v === 'uuid()' || v === 'cuid()') defaultClause = ''; // app-side
      }
      const nullable = isOptional ? ' NULL' : ' NOT NULL';
      fields.push({ name: fieldName, def: `${mysqlType}${nullable}${defaultClause}` });
    });
    models[name.toLowerCase() + 's'] = { name, fields }; // approximate table mapping
    // Honour @@map(...) override
    const mapMatch = body.match(/@@map\("([^"]+)"\)/);
    if (mapMatch) {
      delete models[name.toLowerCase() + 's'];
      models[mapMatch[1].toLowerCase()] = { name, fields };
    }
  }
  return models;
}

(async () => {
  const schemaPath = path.join(__dirname, 'schema.prisma');
  const schemaText = fs.readFileSync(schemaPath, 'utf8');
  const models = parseSchema(schemaText);

  const c = await m.createConnection({
    host: '127.0.0.1',
    user: 'root',
    database: 'NeoLeadgeDeployment',
  });
  const dbTablesRows = await c.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='NeoLeadgeDeployment'",
  );
  const dbTables = new Set(dbTablesRows.map((r) => r.TABLE_NAME.toLowerCase()));

  const missingTables = [];
  const alters = [];
  for (const [tableLower, info] of Object.entries(models)) {
    if (!dbTables.has(tableLower)) {
      missingTables.push(info.name);
      continue;
    }
    const colsRows = await c.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='NeoLeadgeDeployment' AND LOWER(TABLE_NAME)='${tableLower}'`,
    );
    const dbCols = new Set(colsRows.map((r) => r.COLUMN_NAME.toLowerCase()));
    for (const f of info.fields) {
      if (!dbCols.has(f.name.toLowerCase())) {
        // Find actual table casing
        const actualTable = dbTablesRows.find((r) => r.TABLE_NAME.toLowerCase() === tableLower).TABLE_NAME;
        alters.push(`ALTER TABLE ${actualTable} ADD COLUMN \`${f.name}\` ${f.def};`);
      }
    }
  }
  console.log('=== MISSING TABLES ===');
  console.log(missingTables.join('\n') || '(none)');
  console.log('\n=== MISSING COLUMNS (ALTER statements) ===');
  console.log(alters.join('\n') || '(none)');
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
