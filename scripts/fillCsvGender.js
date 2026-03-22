import fs from 'fs';
import path from 'path';

const FEMALE_TOKENS = new Set([
  'ABIGAIL', 'ADA', 'ADELA', 'ADRIANA', 'AIDE', 'AIXA', 'ALEJANDRA', 'ALEXANDRA', 'ALIZON',
  'ALVINA', 'AMANDINA', 'AMELIA', 'ANA', 'ANABEL', 'ANAHI', 'ANDREA', 'ANGELA', 'ANGIE',
  'ANYELY', 'ANTONIA', 'ANTONIETA', 'ARIELA', 'ARELI', 'ARIZA', 'ASTRID', 'AURELIA', 'AYDE',
  'BELEN', 'BERTHA', 'BETZY', 'BIANCA', 'BRIGITTE', 'BRISA', 'BRISSA', 'CAMILA', 'CAMYLA',
  'CARLA', 'CAROLINA', 'CARMEN', 'CELESTINA', 'CESIA', 'CIARA', 'CIELO', 'CLARA', 'CLAUDIA',
  'CLEIDY', 'CORINA', 'CRISAMEL', 'CRISANYEL', 'CRISTABEL', 'DANA', 'DANELITZ', 'DARIANA',
  'DAYIRA', 'DAYSI', 'DELFI', 'DELIA', 'DENISE', 'DENIT', 'DIANA', 'DORIS', 'ELIZABETH',
  'EMELY', 'EMI', 'EPIFANIA', 'ERIKA', 'ERMELINDA', 'EULALIA', 'EVA', 'EVELIN', 'EVELYN',
  'EYMY', 'FARELTA', 'FATIMA', 'FLOR', 'FRANCES', 'FRANCESCA', 'GAVY', 'GEANNY', 'GENESIS',
  'GIOVANNA', 'GITZELA', 'GLADIS', 'GLADYS', 'GLORIA', 'GRECIA', 'GUADALUPE', 'HILDA',
  'ILAINE', 'INES', 'IRMA', 'IVET', 'JAKELYNI', 'JAMILETH', 'JAZMIN', 'JENNIFER', 'JESENIA',
  'JESUSA', 'JHADE', 'JHOSELINE', 'JOCELY', 'JUANA', 'JUANITA', 'JULIA', 'JULIANA', 'KAREN',
  'KARINA', 'KATY', 'KELLY', 'KEYCI', 'KEYTI', 'KIARA', 'KRISEL', 'LADIS', 'LAURA', 'LEIDY',
  'LEONISA', 'LIDIA', 'LINDSAY', 'LORENA', 'LORENZA', 'LOURDES', 'LUANA', 'LUCI', 'LUCERO',
  'LUCIA', 'LUCIANA', 'LUCILA', 'LUHANA', 'LURDES', 'LUZ', 'LUZMILA', 'MAKEYLA', 'MARIA',
  'MARIBEL', 'MARIELA', 'MARIESTHEL', 'MARISOL', 'MARIANT', 'MARITZA', 'MARY', 'MAYUMI',
  'MELINIA', 'MELISSA', 'MELIZA', 'MERCEDES', 'MIA', 'MICAELA', 'MILET', 'MILETH', 'MILEYDI',
  'MILAGROS', 'MIRIAM', 'MIRIAN', 'MISHELL', 'NALDA', 'NANCY', 'NARZISA', 'NATALI', 'NATALIA',
  'NATALY', 'NAYELI', 'NAYLA', 'NELIDA', 'NELLY', 'NELY', 'NICOL', 'NIKOL', 'NILDA', 'NINFA',
  'NINFE', 'NOELIA', 'NOEMI', 'NOHELIA', 'NOLBERTA', 'NONI', 'NORMA', 'OLGA', 'ORIANA',
  'PAMELA', 'PAOLA', 'PATRICIA', 'PIERINA', 'RAICHEL', 'REGINA', 'RENATA', 'REYNA', 'REYNALDA',
  'ROCIO', 'ROSA', 'ROSALIA', 'ROSARIO', 'ROUSS', 'ROXANA', 'RUBI', 'RUTH', 'SADITH', 'SAMANTA',
  'SAYURI', 'SHARMELI', 'SHEYLA', 'SHIRLEY', 'SOFIA', 'SOL', 'SOLANGE', 'SONIA', 'STHEFA',
  'TATIANA', 'TAYRA', 'VALERIA', 'VALERIANA', 'VANESA', 'VERONICA', 'VIANCY', 'VILMA', 'VIVIAN',
  'WENDY', 'XIMENA', 'YAJAIRA', 'YAMILE', 'YANET', 'YANIRA', 'YARET', 'YDIS', 'YEMI', 'YENIFER',
  'YENNY', 'YENY', 'YESENIA', 'YESICA', 'YESSICA', 'YHOMARA', 'YOLA', 'YOLANDA', 'YOVANA',
  'YULE', 'ZULLY', 'STEPHANIE', 'NICOLLE', 'NICOLE', 'AYLIN', 'JADE', 'LIZBETH', 'DAYANE',
  'RACHEL', 'KRISTELL', 'ABBY', 'LIZET', 'SHARON', 'YISSEL', 'ASHLY', 'KAORY', 'SHANTALL',
  'BECKY', 'YAZMIN', 'LISBETH', 'ALYS', 'ODALIZ', 'ALICE', 'DAYRELY', 'JENYFER', 'MAFER',
  'YENSI', 'AYLEM', 'KHALEASI', 'MADYSON', 'ITZEL', 'JAANAI', 'KRISTHEN',
]);

const MALE_TOKENS = new Set([
  'ABEL', 'ABRAHAN', 'ADRIAN', 'ADRIANO', 'ALBERTO', 'ALEJANDRO', 'ALEXIS', 'ALFREDO', 'ALVARO',
  'ANDDY', 'ANDERSON', 'ANDRE', 'ANDY', 'ANGEL', 'ANGELO', 'ANGGELO', 'ANIBAL', 'ANTERO',
  'ANTHONY', 'ANTONY', 'ARMANDO', 'AROL', 'BRYAN', 'CARLOS', 'CESAR', 'CHRISTIAN', 'CRISTOBAL',
  'CRISTOFER', 'DANIEL', 'DASVID', 'DAVID', 'DAYIRO', 'DAYRON', 'DEIVID', 'DENILSON', 'DERECK',
  'DHARIEN', 'DIEGO', 'DOMINICK', 'DORIAN', 'EDDY', 'EDISON', 'EDSON', 'EDU', 'EDUARD',
  'EDWIN', 'ELMER', 'EMANUEL', 'EMIR', 'ENRIQUE', 'ESNEYDER', 'EVANS', 'FARIT', 'FERNANDO',
  'FLAVIO', 'FRANCO', 'FRANKIE', 'FRANSZUE', 'FREDERICH', 'FREDY', 'GABRIEL', 'GAEL', 'GARETT',
  'GERARDO', 'GERSON', 'GHERALD', 'GIOVANY', 'GONZALO', 'GUSTAVO', 'HEBER', 'HECTOR', 'HENRY',
  'IAGO', 'ISAIAS', 'IVAN', 'JACK', 'JAEN', 'JAIME', 'JAMES', 'JAVIER', 'JEAN', 'JEFERSON',
  'JEFFREY', 'JESUS', 'JHAIR', 'JHEMS', 'JHON', 'JHOSIAS', 'JHOSTIN', 'JIMMY', 'JOE', 'JOHAN',
  'JONATHAN', 'JORGE', 'JOSE', 'JOSEPH', 'JOSUE', 'JUAN', 'JULIO', 'KALED', 'KEVIN', 'LAZLO',
  'LEO', 'LEOCADIO', 'LEONEL', 'LIAM', 'LIAN', 'LINCOLL', 'LUIS', 'MAGDIEL', 'MARCO', 'MATHIAS',
  'MAURICIO', 'MAYNER', 'MESSI', 'MILDER', 'NARCISO', 'NEIL', 'NELSON', 'NEYMAR', 'OLIVER',
  'PABLO', 'PAOLO', 'PAULO', 'PEDRO', 'PERCY', 'RAFAEL', 'RAUL', 'REINALDO', 'REYNALDO',
  'ROBERTO', 'RODRIGO', 'RONY', 'ROYER', 'RUSVEL', 'SAID', 'SEBASTIAN', 'SEM', 'SIMON', 'THIAGO',
  'TONY', 'ULISES', 'VICTOR', 'WALTER', 'WILLIAM', 'WILLIAN', 'XAVI', 'YOSUE', 'JAMED',
  'AZAEL', 'SAMUEL', 'OBED', 'ROY', 'ISRAEL', 'MISAEL', 'CRISTIAN', 'FRANKLIN', 'ESNAYDER',
  'EITHAN', 'YHESMAR', 'IAM', 'BARUK', 'GERAL', 'MILAN', 'BORAN', 'ROXSON', 'ROXON', 'AXEL',
  'GERALD', 'AARON', 'JHOSHIMAR', 'ERICK', 'FARID', 'MARK', 'WYLLIAM', 'JONATAN', 'KALETT',
  'YOSHIMAR', 'OTONIEL', 'DAEL', 'ADRIEL', 'YHONY', 'JACOB', 'ARNOLD', 'ABRAHAM', 'BENJHY',
  'DAXEL', 'ELIAN', 'RYAN', 'MAYKEL', 'KENNETH',
]);

const MALE_ENDING_EXCEPTIONS = new Set(['GUADALUPE', 'ANGELO']);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function extractTokens(value) {
  return normalizeText(value)
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function inferGenderFromName({ names, relationship }) {
  const normalizedRelationship = normalizeText(relationship);
  if (normalizedRelationship === 'MADRE') return 'F';
  if (normalizedRelationship === 'PADRE') return 'M';
  if (['ABUELA', 'HERMANA', 'TIA'].includes(normalizedRelationship)) return 'F';
  if (['ABUELO', 'HERMANO', 'TIO'].includes(normalizedRelationship)) return 'M';

  const tokens = extractTokens(names);
  for (const token of tokens) {
    if (FEMALE_TOKENS.has(token)) return 'F';
    if (MALE_TOKENS.has(token)) return 'M';
  }

  const firstToken = tokens[0] || '';
  if (!firstToken) return null;

  if (firstToken.endsWith('A') && !MALE_ENDING_EXCEPTIONS.has(firstToken)) return 'F';
  if (firstToken.endsWith('O')) return 'M';

  return null;
}

function parseCsvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const header = lines[0] || '';
  const delimiter = header.includes(';') ? ';' : ',';
  const rows = lines.slice(1).filter((line) => line.length > 0).map((line) => line.split(delimiter));
  return { header, delimiter, rows };
}

function writeCsvFile(filePath, header, delimiter, rows) {
  const output = [header, ...rows.map((cols) => cols.join(delimiter))].join('\n');
  try {
    fs.writeFileSync(filePath, output, 'utf8');
    return filePath;
  } catch (error) {
    if (error?.code !== 'EBUSY') throw error;

    const fallbackPath = filePath.replace(/\.csv$/i, '.generated.csv');
    fs.writeFileSync(fallbackPath, output, 'utf8');
    return fallbackPath;
  }
}

function updateFile({ filePath, nameColumn, genderColumn, relationshipColumn = null }) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const { header, delimiter, rows } = parseCsvFile(absolutePath);
  const headers = header.split(delimiter);
  const nameIndex = headers.findIndex((value) => value.toLowerCase() === nameColumn.toLowerCase());
  const genderIndex = headers.findIndex((value) => value.toLowerCase() === genderColumn.toLowerCase());
  const relationshipIndex = relationshipColumn
    ? headers.findIndex((value) => value.toLowerCase() === relationshipColumn.toLowerCase())
    : -1;

  if (nameIndex < 0 || genderIndex < 0) {
    throw new Error(`Columnas no encontradas en ${filePath}`);
  }

  const unresolved = [];
  let updated = 0;

  rows.forEach((cols, rowIndex) => {
    const existing = String(cols[genderIndex] || '').trim().toUpperCase();
    if (existing === 'M' || existing === 'F') return;

    const inferred = inferGenderFromName({
      names: cols[nameIndex] || '',
      relationship: relationshipIndex >= 0 ? cols[relationshipIndex] || '' : '',
    });

    if (!inferred) {
      unresolved.push({
        rowNumber: rowIndex + 2,
        names: cols[nameIndex] || '',
        relationship: relationshipIndex >= 0 ? cols[relationshipIndex] || '' : '',
      });
      return;
    }

    cols[genderIndex] = inferred;
    updated += 1;
  });

  const outputPath = writeCsvFile(absolutePath, header, delimiter, rows);
  return { filePath, outputPath, updated, unresolved };
}

function ensureLogsDir() {
  const logsDir = path.resolve(process.cwd(), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

const FILE_PRESETS = {
  students: {
    filePath: './data/students_2025.csv',
    nameColumn: 'Nombres',
    genderColumn: 'Genero',
  },
  parents: {
    filePath: './data/parents.csv',
    nameColumn: 'names',
    genderColumn: 'gender',
    relationshipColumn: 'relationship',
  },
  students_prim: {
    filePath: './data/students_2025_prim.csv',
    nameColumn: 'Nombres',
    genderColumn: 'Genero',
  },
  parents_prim: {
    filePath: './data/parents_prim.csv',
    nameColumn: 'names',
    genderColumn: 'gender',
    relationshipColumn: 'relationship',
  },
};

function getTargetsFromArgs(args) {
  if (!args.length) return [FILE_PRESETS.students, FILE_PRESETS.parents];

  return args.map((arg) => {
    const preset = FILE_PRESETS[arg];
    if (!preset) {
      throw new Error(`Preset no soportado: ${arg}. Usa uno de: ${Object.keys(FILE_PRESETS).join(', ')}`);
    }
    return preset;
  });
}

function run() {
  const targets = getTargetsFromArgs(process.argv.slice(2));
  const results = targets.map((target) => updateFile(target));

  const logsDir = ensureLogsDir();
  fs.writeFileSync(
    path.join(logsDir, 'fill-csv-gender-report.json'),
    JSON.stringify(results, null, 2),
    'utf8',
  );

  for (const result of results) {
    console.log(`[fillCsvGender] ${result.filePath} updated=${result.updated} unresolved=${result.unresolved.length}`);
  }
  console.log(`[fillCsvGender] report=${path.join(logsDir, 'fill-csv-gender-report.json')}`);
}

run();
