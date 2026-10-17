/* 金額大寫 — the Chinese voucher convention.
   A paper 記賬憑證 carries the amount in words next to the figures precisely so
   that a transcription error cannot pass unnoticed. Worth keeping. */

const DIGITS = ["零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖"];
const UNITS = ["", "拾", "佰", "仟"];
const GROUPS = ["", "萬", "億", "兆"];

function groupToWords(group: number): string {
  let out = "";
  let zero = false;
  let rest = group;
  for (let i = 0; i < 4 && rest > 0; i += 1) {
    const digit = rest % 10;
    if (digit === 0) {
      if (out) zero = true;
    } else {
      out = DIGITS[digit] + UNITS[i] + (zero ? "零" : "") + out;
      zero = false;
    }
    rest = Math.floor(rest / 10);
  }
  return out;
}

export function amountInWords(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "零";
  const negative = value < 0;
  const absolute = Math.abs(value);
  const cents = Math.round((absolute - Math.floor(absolute)) * 100);
  let yuan = Math.floor(absolute);

  let words = "";
  let groupIndex = 0;
  while (yuan > 0) {
    const group = yuan % 10000;
    if (group > 0) {
      const groupWords = groupToWords(group);
      words = groupWords + GROUPS[groupIndex] + words;
    } else if (words && !words.startsWith("零")) {
      words = "零" + words;
    }
    yuan = Math.floor(yuan / 10000);
    groupIndex += 1;
  }
  words = words.replace(/零+$/, "").replace(/零{2,}/g, "零") || "零";

  const jiao = Math.floor(cents / 10);
  const fen = cents % 10;
  let tail = "";
  if (jiao === 0 && fen === 0) tail = "整";
  else {
    if (jiao > 0) tail += `${DIGITS[jiao]}角`;
    else tail += "零";
    if (fen > 0) tail += `${DIGITS[fen]}分`;
  }
  return `${negative ? "負" : ""}${words}元${tail}`;
}

const CURRENCY_WORDS: Record<string, string> = {
  CNY: "人民幣",
  HKD: "港幣",
  AUD: "澳元",
  SGD: "新加坡元",
  USD: "美元",
  EUR: "歐元",
  GBP: "英鎊",
};

export function voucherAmountInWords(amount: number, currency: string): string {
  return `${CURRENCY_WORDS[currency] ?? currency}${amountInWords(amount)}`;
}
