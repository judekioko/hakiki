import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// Serves the stored invoice photo/PDF to members of the business that owns it.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: { id, business: { memberships: { some: { userId: session.userId } } } },
    select: { fileData: true, fileType: true, fileName: true },
  });
  if (!invoice?.fileData) return new Response("Not found", { status: 404 });

  return new Response(Buffer.from(invoice.fileData), {
    headers: {
      "Content-Type": invoice.fileType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${(invoice.fileName ?? "invoice").replace(/["\\\r\n]/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
