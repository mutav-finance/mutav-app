import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-heading font-bold tracking-tight">
          SGR
        </h1>
        <p className="text-muted-foreground text-lg">
          Registered Guarantee System
        </p>
      </div>
      <Button size="lg">Connect Wallet</Button>
    </main>
  );
}
