import { ActivityIcon } from "@/components/animate-ui/icons/activity";

export default function Header() {
  return (
    <div className="flex items-center gap-4">
      <ActivityIcon size={40} color="var(--color-success)" animateOnHover />
      <h1 className="text-3xl font-semibold" style={{ color: "var(--color-text)" }}>
        YS. Health Dashboard
      </h1>
    </div>
  );
}
