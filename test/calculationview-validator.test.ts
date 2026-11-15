import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeDocument } from '../src/analyzer/dispatch';
import { applyTextEdits } from '../src/analyzer/types';

const ROOT = path.resolve(__dirname, '..', '..');

test('HANA-LINT-101..107: valid sample CV_SALES_PROJECTION.hdbcalculationview passes with zero diagnostics', () => {
  const samplePath = path.join(ROOT, 'samples', 'hdi', 'CV_SALES_PROJECTION.hdbcalculationview');
  const xml = fs.readFileSync(samplePath, 'utf8');
  const diags = analyzeDocument({ text: xml, languageId: 'hdbcalculationview', filePath: samplePath });
  assert.deepEqual(diags, []);
});

test('HANA-LINT-101: malformed XML and missing scenario root id', () => {
  const unclosedXml = `<Calculation:scenario id="pkg::Broken">
  <calculationViews>
    <calculationView xsi:type="Calculation:ProjectionView" id="Proj_1">
      <input node="#MISSING"/>
  </calculationViews>
</Calculation:scenario>`;
  const diags = analyzeDocument({ text: unclosedXml, languageId: 'hdbcalculationview' });
  assert.ok(diags.some((d) => d.ruleId === 'HANA-LINT-101'));

  const missingRootId = `<Calculation:scenario xmlns:Calculation="http://www.sap.com/ndb/BiModelCalculation.ecore">
  <dataSources/>
  <calculationViews/>
  <logicalModel id="X"/>
</Calculation:scenario>`;
  const missingIdDiags = analyzeDocument({ text: missingRootId, languageId: 'hdbcalculationview' });
  assert.ok(missingIdDiags.some((d) => d.ruleId === 'HANA-LINT-101'));
});

test('HANA-LINT-102 / 103 / 104 / 105: unresolved input, cyclic graph, bad arity, CUBE/DIMENSION measures, duplicate ID', () => {
  const brokenCv = `<Calculation:scenario id="app::BROKEN_CV" dataCategory="DIMENSION" applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE">
  <dataSources>
    <DataSource id="DS_1" type="DATA_BASE_TABLE"><resourceUri>ORDERS</resourceUri></DataSource>
    <DataSource id="DS_1" type="DATA_BASE_TABLE"><resourceUri>DUP</resourceUri></DataSource>
  </dataSources>
  <calculationViews>
    <calculationView xsi:type="Calculation:JoinView" id="Join_1">
      <input node="#Proj_A"/>
    </calculationView>
    <calculationView xsi:type="Calculation:ProjectionView" id="Proj_A">
      <input node="#Join_1"/>
    </calculationView>
    <calculationView xsi:type="Calculation:ProjectionView" id="Proj_Unresolved">
      <input node="#NO_SUCH_SOURCE"/>
    </calculationView>
  </calculationViews>
  <logicalModel id="Unknown_Node">
    <attributes>
      <attribute id="C1"><keyMapping columnObjectName="NoSuchObj" columnName="C1"/></attribute>
    </attributes>
    <baseMeasures>
      <measure id="AMT" aggregationType="sum"><measureMapping columnObjectName="DS_1" columnName="AMT"/></measure>
    </baseMeasures>
  </logicalModel>
</Calculation:scenario>`;

  const diags = analyzeDocument({ text: brokenCv, languageId: 'hdbcalculationview' });
  const ids = new Set(diags.map((d) => d.ruleId));
  for (const expected of ['HANA-LINT-102', 'HANA-LINT-103', 'HANA-LINT-104', 'HANA-LINT-105']) {
    assert.ok(ids.has(expected), `Expected ${expected} in broken calc view`);
  }

  // CUBE without any measures triggers HANA-LINT-104 warning
  const cubeNoMeasures = `<Calculation:scenario id="app::EMPTY_CUBE" dataCategory="CUBE" applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE">
  <dataSources><DataSource id="DS_1" type="DATA_BASE_TABLE"><resourceUri>T</resourceUri></DataSource></dataSources>
  <calculationViews>
    <calculationView xsi:type="Calculation:ProjectionView" id="Proj_1"><input node="#DS_1"/></calculationView>
  </calculationViews>
  <logicalModel id="Proj_1"><attributes><attribute id="ID"/></attributes></logicalModel>
</Calculation:scenario>`;
  assert.ok(analyzeDocument({ text: cubeNoMeasures, languageId: 'hdbcalculationview' }).some((d) => d.ruleId === 'HANA-LINT-104'));
});

test('HANA-LINT-106 / 107: legacy privilege setting, XSC schemaName/defaultSchema, ScriptView, and QuickFixes', () => {
  const legacyCv = `<Calculation:scenario
    id="app::LEGACY_CV"
    dataCategory="CUBE"
    defaultSchema="MYSCHEMA"
    applyPrivilegeType="ANALYTIC_PRIVILEGE">
  <dataSources>
    <DataSource id="DS_1" type="DATA_BASE_TABLE">
      <columnObject schemaName="MYSCHEMA" columnObjectName="ORDERS"/>
    </DataSource>
  </dataSources>
  <calculationViews>
    <calculationView xsi:type="Calculation:ScriptView" id="Script_1"/>
  </calculationViews>
  <logicalModel id="Script_1">
    <baseMeasures><measure id="AMT" aggregationType="sum"/></baseMeasures>
  </logicalModel>
</Calculation:scenario>`;

  const diags = analyzeDocument({ text: legacyCv, languageId: 'hdbcalculationview' });
  const lint106 = diags.find((d) => d.ruleId === 'HANA-LINT-106');
  const lint107 = diags.filter((d) => d.ruleId === 'HANA-LINT-107');

  assert.ok(lint106, 'Expected HANA-LINT-106 for ANALYTIC_PRIVILEGE');
  assert.equal(lint107.length, 3, 'Expected defaultSchema, schemaName, and ScriptView diagnostics');

  const fixedPriv = applyTextEdits(legacyCv, lint106.fixes[0].edits);
  assert.match(fixedPriv, /applyPrivilegeType="SQL_ANALYTIC_PRIVILEGE"/);

  const schemaFix = lint107.find((d) => d.fixes.length > 0 && d.message.includes('defaultSchema'))!;
  const fixedDefSchema = applyTextEdits(legacyCv, schemaFix.fixes[0].edits);
  assert.equal(/defaultSchema=/.test(fixedDefSchema), false);
});
