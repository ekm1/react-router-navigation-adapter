import { describe, expect, it } from 'vitest';
import { formatAuditReport, transformSource } from '../codemod/transform';

describe('Item 14: Migration codemod', () => {
  it('rewrites all supported symbols from both react-router and react-router-dom', () => {
    const input = [
      "import { useHistory, useLocation, useParams, useRouteMatch, withRouter, matchPath, generatePath } from 'react-router';",
      "import { Link, Redirect, Prompt } from 'react-router-dom';",
      '',
      'export const ok = [useHistory, useLocation, useParams, useRouteMatch, withRouter, matchPath, generatePath, Link, Redirect, Prompt];',
    ].join('\n');

    const result = transformSource(input, 'src/Screen.tsx');
    expect(result.changed).toBe(true);
    expect(result.rewrittenSymbols).toEqual(
      expect.arrayContaining([
        'useHistory',
        'useLocation',
        'useParams',
        'useRouteMatch',
        'withRouter',
        'matchPath',
        'generatePath',
        'Link',
        'Redirect',
        'Prompt',
      ]),
    );
    expect(result.code).not.toContain("'react-router'");
    expect(result.code).not.toContain("'react-router-dom'");
    expect(result.code).toContain(
      "import { useHistory, useLocation, useParams, useRouteMatch, withRouter, matchPath, generatePath, Link, Redirect, Prompt } from 'react-router-navigation-adapter';",
    );

    // Running a second time is idempotent
    const second = transformSource(result.code, 'src/Screen.tsx');
    expect(second.changed).toBe(false);
    expect(second.code).toBe(result.code);
  });

  it('splits partial imports, preserves aliases and type imports, and merges into existing adapter imports', () => {
    const input = [
      "import { useRouter } from 'react-router-navigation-adapter';",
      "import { Route, Switch, Link as RouterLink, Redirect, type RouteComponentProps } from 'react-router-dom';",
      "import type { RouteComponentProps as RCP } from 'react-router';",
      '',
      'export const x = [useRouter, Route, Switch, RouterLink, Redirect];',
      'export type Props = RouteComponentProps & RCP;',
    ].join('\n');

    const result = transformSource(input, 'src/Feature.tsx');
    expect(result.changed).toBe(true);
    expect(result.code).toContain(
      "import { useRouter, Link as RouterLink, Redirect, type RouteComponentProps } from 'react-router-navigation-adapter';",
    );
    expect(result.code).toContain("import { Route, Switch } from 'react-router-dom';");
    expect(result.code).toContain(
      "import type { RouteComponentProps as RCP } from 'react-router-navigation-adapter';",
    );
    expect(result.code).not.toContain("from 'react-router'");
  });

  it('supports a custom targetPackage option', () => {
    const input = 'import { useParams, Link } from "react-router-dom"\n';
    const result = transformSource(input, 'src/Nav.tsx', {
      targetPackage: '@acme/router-adapter',
    });
    expect(result.changed).toBe(true);
    expect(result.code).toBe('import { useParams, Link } from "@acme/router-adapter"\n');
  });

  it('detects all unsupported usages in the audit report with line/column and hints', () => {
    const input = [
      "import { Route, NavLink, matchPath, useRouteMatch } from 'react-router-dom';",
      '',
      'export function LegacyRoutes() {',
      '  const m = useRouteMatch(["/items", "/items/:id"]);',
      '  const m2 = matchPath("/a/b", { path: "*/preview/:previewId" });',
      '  const q = window.location.search;',
      '  window.location.assign("/external");',
      '  window.history.pushState({}, "", "/other");',
      '  return (',
      '    <>',
      '      <Route path={["/projects", "/projects/:id"]} render={() => <div />} />',
      '      <Route path="*/drawer/:drawerId" component={() => <div />} />',
      '      <Route path="/files/*" component={() => <div />} />',
      '      <NavLink to="/items" isActive={(match, loc) => Boolean(match && loc.search)}>Items</NavLink>',
      '    </>',
      '  );',
      '}',
    ].join('\n');

    const result = transformSource(input, 'src/LegacyRoutes.tsx');
    const kinds = result.findings.map((f) => f.kind);

    expect(kinds.filter((k) => k === 'path-array')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'non-trailing-wildcard')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'route-render')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'navlink-is-active')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'window-location')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'window-history')).toHaveLength(1);

    // Trailing wildcard "/files/*" must NOT be flagged
    expect(result.findings.some((f) => f.snippet.includes('/files/*'))).toBe(false);

    // Every finding includes valid 1-based coordinates and a remediation hint
    for (const finding of result.findings) {
      expect(finding.filePath).toBe('src/LegacyRoutes.tsx');
      expect(finding.line).toBeGreaterThan(0);
      expect(finding.column).toBeGreaterThan(0);
      expect(finding.hint.length).toBeGreaterThan(10);
    }

    const textReport = formatAuditReport([
      {
        filePath: 'src/LegacyRoutes.tsx',
        changed: result.changed,
        rewrittenSymbols: result.rewrittenSymbols,
        findings: result.findings,
      },
    ]);
    expect(textReport).toContain('[path-array]');
    expect(textReport).toContain('[non-trailing-wildcard]');
    expect(textReport).toContain('[route-render]');
    expect(textReport).toContain('[navlink-is-active]');
    expect(textReport).toContain('[window-location]');
    expect(textReport).toContain('[window-history]');

    const jsonReport = JSON.parse(
      formatAuditReport(
        [
          {
            filePath: 'src/LegacyRoutes.tsx',
            changed: result.changed,
            rewrittenSymbols: result.rewrittenSymbols,
            findings: result.findings,
          },
        ],
        { json: true },
      ),
    );
    expect(jsonReport.findingsCount).toBe(result.findings.length);
  });
});
