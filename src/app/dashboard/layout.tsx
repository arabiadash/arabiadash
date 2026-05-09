import { CurrencyProvider } from "@/lib/contexts/currency-context";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CurrencyProvider>{children}</CurrencyProvider>;
}
