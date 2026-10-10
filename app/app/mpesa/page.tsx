import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireBusiness } from "@/lib/business";
import { businessContext } from "@/lib/form-options";
import { formatDate } from "@/lib/format";
import { num } from "@/lib/money";
import { callbackUrl } from "@/lib/mpesa";
import { registerMpesaUrls, retryMpesaPayment, rotateMpesaToken, simulateMpesaPayment } from "@/lib/actions/mpesa";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { SubmitButton } from "@/components/forms";
import { MpesaSettingsForm } from "@/components/mpesa-forms";

export const metadata = { title: "M-Pesa payments" };

const TONE = { PENDING: "amber", RECORDED: "teal", FAILED: "rose", NEEDS_ATTENTION: "rose" } as const;
const LABEL = { PENDING: "Waiting for the customer", RECORDED: "Recorded", FAILED: "Not paid", NEEDS_ATTENTION: "Needs attention" } as const;

export default async function MpesaPage() {
  const { business } = await requireBusiness();
  const { fmt } = businessContext(business);
  const [config, accounts, transactions] = await Promise.all([
    prisma.mpesaConfig.findUnique({ where: { businessId: business.id } }),
    prisma.account.findMany({ where: { businessId: business.id, moneyKind: { not: null }, currency: null, isArchived: false }, orderBy: { code: "asc" }, select: { id: true, name: true } }),
    prisma.mpesaTransaction.findMany({ where: { businessId: business.id }, orderBy: { createdAt: "desc" }, take: 25 }),
  ]);
  const confirmation = config ? await callbackUrl(business.id, config.callbackToken, "confirmation") : null;
  const validation = config ? await callbackUrl(business.id, config.callbackToken, "validation") : null;
  const stk = config ? await callbackUrl(business.id, config.callbackToken, "stk") : null;
  const reachable = !!confirmation && !/localhost|127\.0\.0\.1|^http:/.test(confirmation);
  const canManage = business.role !== "STAFF";

  return (
    <div className="space-y-6">
      <PageHeader
        title="M-Pesa payments"
        description="Connect your paybill or till to Safaricom Daraja so customer payments are recorded and matched to invoices the moment they are made."
      />

      <Card>
        <CardHeader>
          <CardTitle>1. Create a Daraja app</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm text-slate-600">
          <p>
            Sign in at{" "}
            <a href="https://developer.safaricom.co.ke" target="_blank" rel="noreferrer" className="text-teal-700 underline">
              developer.safaricom.co.ke
            </a>{" "}
            and open <strong>My Apps</strong>. Create an app with <strong>Lipa na M-Pesa Sandbox</strong> and <strong>C2B</strong> enabled, then copy its
            <strong> Consumer Key</strong> and <strong>Consumer Secret</strong>. For sandbox, the paybill is <code>174379</code> and the passkey is shown under
            <em> APIs → Lipa na M-Pesa Online → Simulate</em>. Enter them below. They are stored encrypted and never shown again.
          </p>
          <p className="text-xs text-slate-500">When you are ready for real payments, repeat this with a production app and your own paybill, then switch the environment to Production.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Your settings</CardTitle>
        </CardHeader>
        <CardBody>
          {canManage ? (
            <MpesaSettingsForm
              defaults={
                config
                  ? {
                      environment: config.environment,
                      shortcode: config.shortcode,
                      shortcodeType: config.shortcodeType,
                      moneyAccountId: config.moneyAccountId,
                      hasKeys: true,
                      hasPasskey: !!config.passkeyEnc,
                    }
                  : null
              }
              accounts={accounts}
            />
          ) : (
            <p className="text-sm text-slate-600">Only an owner or accountant can change these settings.</p>
          )}
        </CardBody>
      </Card>

      {config ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Tell Safaricom where to send payments</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm text-slate-600">
            <p>
              Status:{" "}
              {config.urlsRegisteredAt ? <Badge tone="teal">Registered {formatDate(config.urlsRegisteredAt)}</Badge> : <Badge tone="amber">Not registered yet</Badge>}{" "}
              <Badge>{config.environment === "SANDBOX" ? "Sandbox" : "Production"}</Badge>
            </p>
            {!reachable ? (
              <p className="rounded-md bg-amber-50 p-3 text-amber-800">
                These addresses are on your own computer, so Safaricom cannot reach them. Put Hakiki on a public https address (or run a tunnel such as
                ngrok or Cloudflare Tunnel to this app) and set <code>APP_URL</code> to it, then register.
              </p>
            ) : null}
            <dl className="space-y-1 rounded-md bg-slate-50 p-3 text-xs">
              <div>
                <dt className="font-semibold text-slate-700">Confirmation</dt>
                <dd className="break-all font-mono">{confirmation}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-700">Validation</dt>
                <dd className="break-all font-mono">{validation}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-700">Payment requests (STK)</dt>
                <dd className="break-all font-mono">{stk}</dd>
              </div>
            </dl>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <form action={registerMpesaUrls}>
                  <SubmitButton pendingText="Registering...">{config.urlsRegisteredAt ? "Register again" : "Register with Safaricom"}</SubmitButton>
                </form>
                <form action={rotateMpesaToken}>
                  <SubmitButton variant="ghost" size="sm">
                    Change the secret in these addresses
                  </SubmitButton>
                </form>
              </div>
            ) : null}
            <p className="text-xs text-slate-500">
              Customers pay your paybill using an invoice number (for example INV-0031) as the account number and the payment is matched to that invoice
              automatically. Other payments are matched by amount and name, or left for you to match on Money received.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {config?.environment === "SANDBOX" && canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>4. Try it with a pretend payment</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <form action={simulateMpesaPayment} className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-slate-500">
                Amount
                <Input name="amount" type="number" min="1" step="1" defaultValue={100} className="mt-1 w-32" />
              </label>
              <label className="text-xs text-slate-500">
                Account number (an invoice number)
                <Input name="billRef" placeholder="INV-0031" className="mt-1 w-48" />
              </label>
              <SubmitButton variant="secondary" size="sm" pendingText="Sending...">
                Send a test payment
              </SubmitButton>
            </form>
            <p className="text-xs text-slate-500">Sandbox only. Needs the addresses above to be registered and reachable.</p>
          </CardBody>
        </Card>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Recent M-Pesa activity</h2>
        {transactions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>When</Th>
                <Th>Receipt no.</Th>
                <Th>Account / invoice</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
                <Th>Note</Th>
              </Tr>
            </Thead>
            <Tbody>
              {transactions.map((t) => (
                <Tr key={t.id}>
                  <Td className="whitespace-nowrap">{formatDate(t.createdAt)}</Td>
                  <Td className="font-mono text-xs">{t.transId ?? "—"}</Td>
                  <Td>
                    {t.billRef ?? "—"}
                    {t.receiptId ? (
                      <>
                        {" · "}
                        <Link href={`/app/sales/receipts/${t.receiptId}`} className="text-teal-700 hover:underline">
                          receipt
                        </Link>
                      </>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap text-right">{t.amount ? fmt(num(t.amount)) : "—"}</Td>
                  <Td>
                    <Badge tone={TONE[t.status]}>{t.kind === "STK" ? "Request: " : ""}{LABEL[t.status]}</Badge>
                  </Td>
                  <Td className="text-xs text-slate-500">
                    {t.note ?? ""}
                    {t.status === "NEEDS_ATTENTION" && t.transId && canManage ? (
                      <form action={retryMpesaPayment} className="mt-1">
                        <input type="hidden" name="id" value={t.id} />
                        <SubmitButton variant="secondary" size="sm" pendingText="Trying...">
                          Try again
                        </SubmitButton>
                      </form>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
