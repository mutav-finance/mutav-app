import { Input } from "./input";

// The input owns its placeholder: the "R$" adornment is already rendered, so a
// caller-supplied "R$ 0,00" doubles the symbol. The sample is pt-BR in every
// locale because callers parse the value as pt-BR (dot = thousands, comma =
// decimal) — an en-style "0.00" hint would invite input that parses 100× off.
const AMOUNT_PLACEHOLDER = "0,00";

export function CurrencyInput({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
}) {
  return (
    <div className="relative">
      <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm select-none">
        R$
      </span>
      <Input
        className="pl-8"
        value={value}
        placeholder={AMOUNT_PLACEHOLDER}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
      />
    </div>
  );
}
