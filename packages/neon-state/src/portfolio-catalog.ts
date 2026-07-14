import { neon } from '@neondatabase/serverless';
import type { PortfolioItem } from '@sales-automation/shared';

export type PortfolioApprovalStatus = 'draft' | 'approved' | 'archived';
export type PortfolioAssetHealth = 'unchecked' | 'available' | 'broken';

export interface ManagedPortfolioItem extends PortfolioItem {
  approvalStatus: PortfolioApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  approvedProofStatement?: string;
  approvedOutreachParagraph?: string;
  shareInstructions?: string;
  doNotDisclose?: string;
  deliveryModel?: string;
  assetHealth?: PortfolioAssetHealth;
  createdAt: string;
  updatedAt: string;
}

interface PortfolioRow {
  item: unknown;
}

export async function ensurePortfolioCatalogSchema(databaseUrl: string): Promise<void> {
  const sql = neon(requirePortfolioDatabaseUrl(databaseUrl));
  await sql`
    CREATE TABLE IF NOT EXISTS portfolio_catalog (
      portfolio_id TEXT PRIMARY KEY,
      item JSONB NOT NULL,
      approval_status TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS portfolio_catalog_approval_idx
    ON portfolio_catalog (approval_status, updated_at DESC)
  `;
}

export async function loadPortfolioCatalog(databaseUrl: string): Promise<ManagedPortfolioItem[]> {
  await ensurePortfolioCatalogSchema(databaseUrl);
  const sql = neon(requirePortfolioDatabaseUrl(databaseUrl));
  const rows = await sql`
    SELECT item
    FROM portfolio_catalog
    ORDER BY
      CASE approval_status WHEN 'approved' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
      updated_at DESC
  ` as PortfolioRow[];
  return rows
    .map((row) => parseManagedPortfolioItem(row.item))
    .filter((item): item is ManagedPortfolioItem => Boolean(item));
}

export async function loadApprovedPortfolioCatalog(databaseUrl: string): Promise<ManagedPortfolioItem[]> {
  const items = await loadPortfolioCatalog(databaseUrl);
  return items.filter((item) => item.approvalStatus === 'approved' && item.assetHealth !== 'broken');
}

export async function upsertPortfolioCatalogItem(
  databaseUrl: string,
  item: ManagedPortfolioItem,
): Promise<ManagedPortfolioItem> {
  validateManagedPortfolioItem(item);
  await ensurePortfolioCatalogSchema(databaseUrl);
  const sql = neon(requirePortfolioDatabaseUrl(databaseUrl));
  await sql`
    INSERT INTO portfolio_catalog (portfolio_id, item, approval_status, updated_at)
    VALUES (${item.id}, ${JSON.stringify(item)}::jsonb, ${item.approvalStatus}, NOW())
    ON CONFLICT (portfolio_id) DO UPDATE SET
      item = EXCLUDED.item,
      approval_status = EXCLUDED.approval_status,
      updated_at = NOW()
  `;
  return item;
}

export async function archivePortfolioCatalogItem(
  databaseUrl: string,
  portfolioId: string,
  actor: string,
  updatedAt = new Date().toISOString(),
): Promise<ManagedPortfolioItem | undefined> {
  const items = await loadPortfolioCatalog(databaseUrl);
  const existing = items.find((item) => item.id === portfolioId);
  if (!existing) return undefined;
  const archived: ManagedPortfolioItem = {
    ...existing,
    approvalStatus: 'archived',
    updatedAt,
    approvedBy: existing.approvedBy ?? actor,
  };
  return upsertPortfolioCatalogItem(databaseUrl, archived);
}

export async function ensurePortfolioCatalogSeeded(
  databaseUrl: string,
  starterItems: ManagedPortfolioItem[],
): Promise<{ seeded: number; existing: number }> {
  const existingItems = await loadPortfolioCatalog(databaseUrl);
  const existingIds = new Set(existingItems.map((item) => item.id));
  let seeded = 0;
  for (const item of starterItems) {
    if (existingIds.has(item.id)) continue;
    await upsertPortfolioCatalogItem(databaseUrl, item);
    seeded += 1;
  }
  return { seeded, existing: existingItems.length };
}

export function asPortfolioItems(items: ManagedPortfolioItem[]): PortfolioItem[] {
  return items.map((item) => ({ ...item }));
}

export function replacePortfolioArray(target: PortfolioItem[], items: PortfolioItem[]): void {
  target.splice(0, target.length, ...items);
}

function parseManagedPortfolioItem(value: unknown): ManagedPortfolioItem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Partial<ManagedPortfolioItem>;
  if (!item.id || !item.projectName || !item.confidentiality || !Array.isArray(item.serviceCategories)) return undefined;
  return item as ManagedPortfolioItem;
}

function validateManagedPortfolioItem(item: ManagedPortfolioItem): void {
  if (!item.id.trim()) throw new Error('Portfolio item id is required.');
  if (!item.projectName.trim()) throw new Error('Project name is required.');
  if (!['draft', 'approved', 'archived'].includes(item.approvalStatus)) throw new Error('Approval status is invalid.');
  if (!['public', 'private', 'anonymized'].includes(item.confidentiality)) throw new Error('Confidentiality is invalid.');
  if (item.serviceCategories.length === 0) throw new Error('At least one service category is required.');
  if (item.approvalStatus === 'approved') {
    if (!item.approvedBy?.trim()) throw new Error('Approved items require an approver.');
    if (!item.approvedAt?.trim()) throw new Error('Approved items require an approval date.');
    if (!item.approvedProofStatement?.trim()) throw new Error('Approved items require an approved proof statement.');
  }
  if (item.confidentiality === 'private' && item.approvalStatus === 'approved' && !item.doNotDisclose?.trim()) {
    throw new Error('Approved private items require a do-not-disclose instruction.');
  }
}

function requirePortfolioDatabaseUrl(value: string | undefined): string {
  if (!value?.trim()) throw new Error('DATABASE_URL is required. Connect a Neon Postgres database to the Vercel project.');
  return value.trim();
}
