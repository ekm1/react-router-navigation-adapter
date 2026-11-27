import ts from 'typescript';

export const DEFAULT_TARGET_PACKAGE = 'react-router-navigation-adapter';

export const SOURCE_PACKAGES = new Set(['react-router', 'react-router-dom']);

export const MIGRATABLE_SYMBOLS = new Set([
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
  'RouteComponentProps',
]);

export type AuditKind =
  | 'path-array'
  | 'non-trailing-wildcard'
  | 'route-render'
  | 'navlink-is-active'
  | 'window-location'
  | 'window-history';

export interface AuditFinding {
  kind: AuditKind;
  filePath: string;
  line: number;
  column: number;
  snippet: string;
  hint: string;
}

export interface TransformOptions {
  /** Adapter package name to rewrite imports to (default: `'react-router-navigation-adapter'`). */
  targetPackage?: string;
}

export interface TransformResult {
  code: string;
  changed: boolean;
  rewrittenSymbols: string[];
  findings: AuditFinding[];
}

interface SpecifierInfo {
  importedName: string;
  localName: string;
  isTypeOnly: boolean;
}

interface TextEdit {
  start: number;
  end: number;
  replacement: string;
}

function formatSpecifier(spec: SpecifierInfo, declarationIsTypeOnly: boolean): string {
  const prefix = !declarationIsTypeOnly && spec.isTypeOnly ? 'type ' : '';
  return spec.importedName === spec.localName
    ? `${prefix}${spec.importedName}`
    : `${prefix}${spec.importedName} as ${spec.localName}`;
}

function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function isNonTrailingWildcard(pattern: string): boolean {
  if (!pattern.includes('*')) return false;
  // Valid trailing wildcard is either "*" alone or ends with "/*" and has no earlier "*"
  const withoutTrailing = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;
  return withoutTrailing.includes('*');
}

function makeSnippet(sourceFile: ts.SourceFile, node: ts.Node): string {
  const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function collectFindings(sourceFile: ts.SourceFile, filePath: string): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const push = (kind: AuditKind, node: ts.Node, hint: string) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      kind,
      filePath,
      line: line + 1,
      column: character + 1,
      snippet: makeSnippet(sourceFile, node),
      hint,
    });
  };

  const checkPatternExpr = (expr: ts.Expression, allowArrayReport: boolean) => {
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      if (isNonTrailingWildcard(expr.text)) {
        push(
          'non-trailing-wildcard',
          expr,
          'Non-trailing wildcards are unsupported; express suffix overlays with `overlay: true` in defineRoutes().',
        );
      }
      return;
    }
    if (ts.isArrayLiteralExpression(expr)) {
      if (allowArrayReport) {
        push(
          'path-array',
          expr,
          'Move multi-path routes into defineRoutes({ Name: { path: [...] } }).',
        );
      }
      for (const el of expr.elements) {
        if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) {
          if (isNonTrailingWildcard(el.text)) {
            push(
              'non-trailing-wildcard',
              el,
              'Non-trailing wildcards are unsupported; express suffix overlays with `overlay: true` in defineRoutes().',
            );
          }
        }
      }
    }
  };

  const visit = (node: ts.Node) => {
    // 1. JSX <Route ...> and <NavLink ...>
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      if (tagName === 'Route' || tagName.endsWith('.Route')) {
        for (const prop of node.attributes.properties) {
          if (!ts.isJsxAttribute(prop)) continue;
          const attrName = prop.name.getText(sourceFile);
          if (attrName === 'render') {
            push(
              'route-render',
              prop,
              'Replace <Route render={...}> with a route entry in defineRoutes() (use `guard` for conditional rendering/redirects).',
            );
          } else if (
            attrName === 'children' &&
            prop.initializer &&
            ts.isJsxExpression(prop.initializer) &&
            prop.initializer.expression &&
            (ts.isArrowFunction(prop.initializer.expression) ||
              ts.isFunctionExpression(prop.initializer.expression))
          ) {
            push(
              'route-render',
              prop,
              'Replace function-child <Route children={...}> with a route entry in defineRoutes().',
            );
          } else if (attrName === 'path' && prop.initializer) {
            if (ts.isStringLiteral(prop.initializer)) {
              checkPatternExpr(prop.initializer, true);
            } else if (ts.isJsxExpression(prop.initializer) && prop.initializer.expression) {
              checkPatternExpr(prop.initializer.expression, true);
            }
          }
        }
      } else if (tagName === 'NavLink' || tagName.endsWith('.NavLink')) {
        for (const prop of node.attributes.properties) {
          if (ts.isJsxAttribute(prop) && prop.name.getText(sourceFile) === 'isActive') {
            push(
              'navlink-is-active',
              prop,
              'Replace <NavLink isActive={...}> with adapter <Link isActive={...} activeClassName={...} activeStyle={...} exact={...}>.',
            );
          }
        }
      }
    }

    // 2. matchPath(pathname, patternOrOptions) and useRouteMatch(patternOrOptions)
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      const patternArg =
        callee === 'matchPath' ? node.arguments[1] : callee === 'useRouteMatch' ? node.arguments[0] : undefined;
      if (patternArg) {
        if (ts.isObjectLiteralExpression(patternArg)) {
          for (const prop of patternArg.properties) {
            if (ts.isPropertyAssignment(prop) && prop.name.getText(sourceFile) === 'path') {
              checkPatternExpr(prop.initializer, true);
            }
          }
        } else {
          checkPatternExpr(patternArg, true);
        }
      }
    }

    // 3. window.location / globalThis.location and window.history / globalThis.history
    if (ts.isPropertyAccessExpression(node)) {
      const target = node.expression.getText(sourceFile);
      if (target === 'window' || target === 'globalThis') {
        const propName = node.name.text;
        if (propName === 'location') {
          const parent = ts.isPropertyAccessExpression(node.parent) || ts.isCallExpression(node.parent)
            ? node.parent
            : node;
          push(
            'window-location',
            parent,
            'window.location does not exist on React Native; use getRouter().getLocation(), openExternal(url), or reload().',
          );
        } else if (propName === 'history') {
          const parent = ts.isPropertyAccessExpression(node.parent) || ts.isCallExpression(node.parent)
            ? node.parent
            : node;
          push(
            'window-history',
            parent,
            'window.history does not exist on React Native; use useRouter() or getRouter() navigation methods.',
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

/**
 * Rewrites React Router v5 imports (`'react-router'` and `'react-router-dom'`) to the adapter
 * package and returns an audit list of unsupported or platform-specific usages.
 */
export function transformSource(
  source: string,
  filePath = 'file.tsx',
  options: TransformOptions = {},
): TransformResult {
  const targetPackage = options.targetPackage ?? DEFAULT_TARGET_PACKAGE;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath),
  );

  const findings = collectFindings(sourceFile, filePath);
  const edits: TextEdit[] = [];
  const movedValueSpecs: SpecifierInfo[] = [];
  const movedTypeSpecs: SpecifierInfo[] = [];
  const rewrittenSymbols: string[] = [];

  let existingAdapterValueImport: ts.ImportDeclaration | null = null;
  let existingAdapterTypeImport: ts.ImportDeclaration | null = null;
  let firstSourceImport: ts.ImportDeclaration | null = null;
  let detectedQuote = "'";
  let detectedSemicolon = ';';

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const mod = stmt.moduleSpecifier.text;
    const clause = stmt.importClause;
    if (!clause) continue;

    if (mod === targetPackage) {
      if (clause.isTypeOnly && !existingAdapterTypeImport) {
        existingAdapterTypeImport = stmt;
      } else if (!clause.isTypeOnly && !existingAdapterValueImport) {
        existingAdapterValueImport = stmt;
      }
      continue;
    }

    if (!SOURCE_PACKAGES.has(mod)) continue;
    if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;

    const rawSpec = stmt.moduleSpecifier.getText(sourceFile);
    if (rawSpec.startsWith('"')) detectedQuote = '"';
    const rawStmt = stmt.getText(sourceFile);
    if (!rawStmt.trimEnd().endsWith(';')) detectedSemicolon = '';

    const kept: SpecifierInfo[] = [];
    const movedHere: SpecifierInfo[] = [];

    for (const el of clause.namedBindings.elements) {
      const importedName = el.propertyName ? el.propertyName.text : el.name.text;
      const localName = el.name.text;
      const info: SpecifierInfo = {
        importedName,
        localName,
        isTypeOnly: Boolean(clause.isTypeOnly || el.isTypeOnly),
      };
      if (MIGRATABLE_SYMBOLS.has(importedName)) {
        movedHere.push(info);
        rewrittenSymbols.push(importedName);
        if (clause.isTypeOnly) {
          movedTypeSpecs.push(info);
        } else {
          movedValueSpecs.push(info);
        }
      } else {
        kept.push(info);
      }
    }

    if (movedHere.length === 0) continue;
    if (!firstSourceImport) firstSourceImport = stmt;

    const stmtStart = stmt.getStart(sourceFile);
    const stmtEnd = stmt.getEnd();

    if (kept.length === 0 && !clause.name) {
      // Remove entire import statement including trailing newline if present
      let deleteEnd = stmtEnd;
      if (source[deleteEnd] === '\r' && source[deleteEnd + 1] === '\n') deleteEnd += 2;
      else if (source[deleteEnd] === '\n') deleteEnd += 1;
      edits.push({ start: stmtStart, end: deleteEnd, replacement: '' });
    } else {
      const parts: string[] = [];
      if (clause.name) parts.push(clause.name.text);
      if (kept.length > 0) {
        parts.push(`{ ${kept.map((s) => formatSpecifier(s, Boolean(clause.isTypeOnly))).join(', ')} }`);
      }
      const typeKw = clause.isTypeOnly ? 'type ' : '';
      const q = rawSpec.startsWith('"') ? '"' : "'";
      const semi = rawStmt.trimEnd().endsWith(';') ? ';' : '';
      edits.push({
        start: stmtStart,
        end: stmtEnd,
        replacement: `import ${typeKw}${parts.join(', ')} from ${q}${mod}${q}${semi}`,
      });
    }
  }

  if (movedValueSpecs.length === 0 && movedTypeSpecs.length === 0) {
    return { code: source, changed: false, rewrittenSymbols: [], findings };
  }

  const dedupeSpecs = (specs: SpecifierInfo[], existingNames: Set<string>): SpecifierInfo[] => {
    const out: SpecifierInfo[] = [];
    for (const s of specs) {
      const key = `${s.isTypeOnly ? 'T:' : 'V:'}${s.importedName}:${s.localName}`;
      if (existingNames.has(key)) continue;
      existingNames.add(key);
      out.push(s);
    }
    return out;
  };

  const mergeIntoExisting = (decl: ts.ImportDeclaration, toAdd: SpecifierInfo[]): boolean => {
    const clause = decl.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
    const existingKeys = new Set<string>();
    const existingList: SpecifierInfo[] = clause.namedBindings.elements.map((el) => {
      const importedName = el.propertyName ? el.propertyName.text : el.name.text;
      const localName = el.name.text;
      const info: SpecifierInfo = {
        importedName,
        localName,
        isTypeOnly: Boolean(clause.isTypeOnly || el.isTypeOnly),
      };
      existingKeys.add(`${info.isTypeOnly ? 'T:' : 'V:'}${info.importedName}:${info.localName}`);
      return info;
    });
    const added = dedupeSpecs(toAdd, existingKeys);
    if (added.length === 0) return true;
    const combined = [...existingList, ...added];
    const parts: string[] = [];
    if (clause.name) parts.push(clause.name.text);
    parts.push(`{ ${combined.map((s) => formatSpecifier(s, Boolean(clause.isTypeOnly))).join(', ')} }`);
    const typeKw = clause.isTypeOnly ? 'type ' : '';
    const rawSpec = decl.moduleSpecifier.getText(sourceFile);
    const q = rawSpec.startsWith('"') ? '"' : "'";
    const semi = decl.getText(sourceFile).trimEnd().endsWith(';') ? ';' : '';
    edits.push({
      start: decl.getStart(sourceFile),
      end: decl.getEnd(),
      replacement: `import ${typeKw}${parts.join(', ')} from ${q}${targetPackage}${q}${semi}`,
    });
    return true;
  };

  const insertLines: string[] = [];

  if (movedValueSpecs.length > 0) {
    if (!existingAdapterValueImport || !mergeIntoExisting(existingAdapterValueImport, movedValueSpecs)) {
      const unique = dedupeSpecs(movedValueSpecs, new Set());
      insertLines.push(
        `import { ${unique.map((s) => formatSpecifier(s, false)).join(', ')} } from ${detectedQuote}${targetPackage}${detectedQuote}${detectedSemicolon}`,
      );
    }
  }

  if (movedTypeSpecs.length > 0) {
    if (existingAdapterTypeImport && mergeIntoExisting(existingAdapterTypeImport, movedTypeSpecs)) {
      // merged into existing `import type`
    } else if (existingAdapterValueImport && movedValueSpecs.length === 0 && mergeIntoExisting(existingAdapterValueImport, movedTypeSpecs)) {
      // merged into existing value import with inline `type` modifier
    } else {
      const unique = dedupeSpecs(movedTypeSpecs, new Set());
      insertLines.push(
        `import type { ${unique.map((s) => formatSpecifier(s, true)).join(', ')} } from ${detectedQuote}${targetPackage}${detectedQuote}${detectedSemicolon}`,
      );
    }
  }

  if (insertLines.length > 0 && firstSourceImport) {
    const insertAt = firstSourceImport.getStart(sourceFile);
    // Find if there's an edit starting at insertAt (e.g. deleted or rewritten firstSourceImport)
    const existingEdit = edits.find((e) => e.start === insertAt);
    const block = `${insertLines.join('\n')}\n`;
    if (existingEdit) {
      existingEdit.replacement = existingEdit.replacement
        ? `${existingEdit.replacement}\n${insertLines.join('\n')}`
        : block;
    } else {
      edits.push({ start: insertAt, end: insertAt, replacement: block });
    }
  }

  // Apply edits from end to start so offsets stay valid
  const sorted = edits.slice().sort((a, b) => b.start - a.start || b.end - a.end);
  let nextCode = source;
  for (const edit of sorted) {
    nextCode = nextCode.slice(0, edit.start) + edit.replacement + nextCode.slice(edit.end);
  }

  return {
    code: nextCode,
    changed: nextCode !== source,
    rewrittenSymbols: Array.from(new Set(rewrittenSymbols)),
    findings,
  };
}

/** Formats a human-readable or JSON migration report across processed files. */
export function formatAuditReport(
  results: Array<{
    filePath: string;
    changed: boolean;
    rewrittenSymbols: string[];
    findings: AuditFinding[];
  }>,
  options: { json?: boolean } = {},
): string {
  const allFindings = results.flatMap((r) => r.findings);
  const changedFiles = results.filter((r) => r.changed);

  if (options.json) {
    return JSON.stringify(
      {
        filesScanned: results.length,
        filesChanged: changedFiles.length,
        findingsCount: allFindings.length,
        findings: allFindings,
      },
      null,
      2,
    );
  }

  const lines: string[] = [];
  lines.push(
    `Migration summary: ${results.length} file(s) scanned, ${changedFiles.length} file(s) rewritten, ${allFindings.length} manual finding(s).`,
  );

  if (changedFiles.length > 0) {
    lines.push('');
    lines.push('Rewritten imports:');
    for (const file of changedFiles) {
      lines.push(`  - ${file.filePath} (${file.rewrittenSymbols.join(', ')})`);
    }
  }

  if (allFindings.length > 0) {
    lines.push('');
    lines.push('Manual migration findings:');
    const counts = new Map<AuditKind, number>();
    for (const f of allFindings) {
      counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
      lines.push(`  [${f.kind}] ${f.filePath}:${f.line}:${f.column}`);
      lines.push(`    code: ${f.snippet}`);
      lines.push(`    hint: ${f.hint}`);
    }
    lines.push('');
    lines.push(
      `By category: ${Array.from(counts.entries())
        .map(([k, n]) => `${k}=${n}`)
        .join(', ')}`,
    );
  }

  return lines.join('\n');
}
