import EndpointDetail from "@/components/EndpointDetail";

export default async function EndpointDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EndpointDetail endpointId={id} />;
}
