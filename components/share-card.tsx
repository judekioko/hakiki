import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { toWhatsAppNumber } from "@/lib/kra";
import { mailConfigured } from "@/lib/mailer";
import { shareMessage, shareUrl, type ShareKind } from "@/lib/share";
import { ShareActions } from "@/components/share-actions";

// "Send to customer" card for a document page: link, WhatsApp, email.
export async function ShareCard({
  kind,
  id,
  business,
  customer,
  number,
  amount,
  dueDate,
}: {
  kind: ShareKind;
  id: string;
  business: { id: string; name: string; currency: string };
  customer: { name: string; phone: string | null; email: string | null };
  number?: string;
  amount?: number;
  dueDate?: Date;
}) {
  const url = await shareUrl(kind, id, business.id);
  const { subject, text } = shareMessage({
    kind,
    customerName: customer.name,
    businessName: business.name,
    number,
    amount,
    currency: business.currency,
    dueDate,
    url,
  });
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Send to customer</CardTitle>
      </CardHeader>
      <CardBody>
        <ShareActions
          kind={kind}
          id={id}
          url={url}
          message={text}
          subject={subject}
          whatsappNumber={toWhatsAppNumber(customer.phone)}
          email={customer.email}
          canSendEmail={mailConfigured()}
        />
      </CardBody>
    </Card>
  );
}
