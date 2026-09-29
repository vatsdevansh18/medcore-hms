import "reflect-metadata";
import * as fs from "fs";
import * as path from "path";
import { CONTROLLER_WATERMARK, METHOD_METADATA } from "@nestjs/common/constants";
import { IS_PUBLIC_KEY } from "../src/auth/decorators/public.decorator";
import { ROLES_KEY } from "../src/auth/decorators/roles.decorator";

/**
 * SEC-AUTHZ-001 promises that CI catches a controller method added without
 * an explicit @Roles() or @Public() decorator, not just RolesGuard's runtime
 * deny-by-default (docs/09-SECURITY.md §4). This test is that CI-time check:
 * it statically scans every *.controller.ts file's exported controller
 * classes and asserts every HTTP route handler carries one or the other,
 * mirroring the exact handler-overrides-class precedence RolesGuard's
 * `reflector.getAllAndOverride` uses at request time. It runs under the e2e
 * Jest config (not the unit one) purely because requiring real controller
 * files transitively pulls in `@nestjs/bullmq` (pure ESM) — only the e2e
 * config carries the `transformIgnorePatterns` fix for that (see
 * `docs/CLAUDE.md`'s "pure-ESM npm package" entry); the check itself needs
 * no database, Redis, or running app.
 */

type AnyClass = new (...args: unknown[]) => unknown;

function findControllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findControllerFiles(full);
    if (entry.name.endsWith(".controller.ts")) return [full];
    return [];
  });
}

function isController(exported: unknown): exported is AnyClass {
  return typeof exported === "function" && Reflect.getMetadata(CONTROLLER_WATERMARK, exported) === true;
}

/** Mirrors `Reflector.getAllAndOverride`: handler metadata wins if the key is present at all, else class metadata. */
function resolveAuthorization(handler: object, controllerClass: AnyClass) {
  const methodPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) as boolean | undefined;
  const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controllerClass) as boolean | undefined;
  const isPublic = methodPublic !== undefined ? methodPublic : classPublic;

  const methodRoles = Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined;
  const classRoles = Reflect.getMetadata(ROLES_KEY, controllerClass) as string[] | undefined;
  const roles = methodRoles !== undefined ? methodRoles : classRoles;

  return { isAuthorized: isPublic === true || (Array.isArray(roles) && roles.length > 0) };
}

const srcRoot = path.join(__dirname, "..", "src");
const controllerFiles = findControllerFiles(srcRoot);

describe("SEC-AUTHZ-001: every route handler declares @Roles() or @Public()", () => {
  it("scanned at least the known controller files (sanity-checks the scan itself)", () => {
    expect(controllerFiles.length).toBeGreaterThanOrEqual(18);
  });

  for (const file of controllerFiles) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const moduleExports: Record<string, unknown> = require(file);
    const relativePath = path.relative(srcRoot, file);

    for (const [exportName, exported] of Object.entries(moduleExports)) {
      if (!isController(exported)) continue;
      const controllerClass = exported;

      const methodNames = Object.getOwnPropertyNames(controllerClass.prototype as object).filter(
        (name) => name !== "constructor",
      );

      for (const methodName of methodNames) {
        const handler = (controllerClass.prototype as Record<string, object>)[methodName];
        const isRouteHandler = Reflect.getMetadata(METHOD_METADATA, handler) !== undefined;
        if (!isRouteHandler) continue;

        const { isAuthorized } = resolveAuthorization(handler, controllerClass);

        it(`${relativePath}: ${exportName}.${methodName} is @Public() or has a non-empty @Roles()`, () => {
          expect(isAuthorized).toBe(true);
        });
      }
    }
  }
});
