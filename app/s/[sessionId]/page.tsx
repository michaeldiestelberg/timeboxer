import { SharedSessionView } from "@/components/shared-session-view"

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params

  return <SharedSessionView sessionId={sessionId} />
}
