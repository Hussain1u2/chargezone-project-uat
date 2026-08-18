const fs = require('fs');
const pdfParse = require('pdf-parse');


const PO_NUMBER_PATTERNS = [
  /P\.?O\.?(?:\s+(?:No\.?|Number|#|Ref\.?|ID))?\s*[:#-]?\s*([A-Za-z0-9\-\/]{3,})/i,
  /Purchase\s*Order(?:\s+(?:No\.?|Number|#|Ref\.?|ID))?\s*[:#-]?\s*([A-Za-z0-9\-\/]{3,})/i,
  /Order(?:\s+(?:No\.?|Number|#|Ref\.?))?\s*[:#-]?\s*([A-Za-z0-9\-\/]{3,})/i,
  /Ref(?:erence)?(?:\s+(?:No\.?|Number|#))?\s*[:#-]?\s*(PO[A-Za-z0-9\-\/]+)/i,
  /\b(PO[-/][A-Za-z0-9\-\/]{3,})\b/i
];

function extractPoNumber(text) {
  if (!text) return null;
  for (const pattern of PO_NUMBER_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const val = match[1].trim();
      if (val.length >= 3 && !/^(number|no|date|details|table)$/i.test(val)) {
        return val;
      }
    }
  }
  return null;
}

function cleanPrice(str) {
  if (!str) return NaN;
  const cleaned = String(str).replace(/[₹$,]/g, '').replace(/rs\.?/gi, '').replace(/inr/gi, '').replace(/-/g, '').trim();
  return parseFloat(cleaned);
}

function isExcludedHeaderOrFooter(name) {
  if (!name || name.length < 2) return true;
  const lower = name.toLowerCase();
  const keywords = [
    'description', 'item name', 'material name', 'particulars', 'hsn/sac', 'hsn code',
    'subtotal', 'sub total', 'grand total', 'taxable value', 'total amount', 'cgst', 'sgst', 'igst',
    'terms & conditions', 'terms and conditions', 'authorized signatory', 'bank details',
    'page ', 'sl.no', 'sr.no', 'item no', 'invoice total', 'discount', 'freight', 'charges'
  ];
  return keywords.some((kw) => lower.includes(kw));
}

function extractLineItems(text) {
  if (!text) return [];

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const items = [];
  const seenNames = new Set();
  let pendingName = '';

  for (const line of lines) {
    let name = null;
    let quantity = null;
    let unitPrice = null;

    const p1 = line.match(/^(?:\d+[\.\)]\s*)?(.+?)\s+(\d+(?:\.\d+)?)\s*(?:pcs|mtr|set|nos|units|kg|m|box|roll|mrs)?\s+(?:[@x|]\s*)?(?:₹|Rs\.?|INR)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:(?:₹|Rs\.?|INR)?\s*(\d+(?:,\d{3})*(?:\.\d+)?))?$/i);
    if (p1) {
      name = p1[1].replace(/^[-|:\t\.\s\d]+/, '').replace(/[-|:\t]+$/, '').trim();
      quantity = parseFloat(p1[2]);
      unitPrice = cleanPrice(p1[3]);

      const totalCand = cleanPrice(p1[4]);
      if (!isNaN(totalCand) && totalCand > 0 && quantity > 0) {
        if (Math.abs(quantity * unitPrice - totalCand) < 5) {
        } else if (Math.abs(quantity * totalCand - unitPrice) < 5) {
          const temp = unitPrice;
          unitPrice = totalCand;
        }
      }
    }

    if (!name || isNaN(quantity) || isNaN(unitPrice)) {
      const p2 = line.match(/(?:Item|Description|Material|Product)\s*[:|-]\s*(.+?)\s+(?:Qty|Quantity)\s*[:|-]\s*(\d+(?:\.\d+)?)\s+(?:Price|Rate|Unit Price|Cost)\s*[:|-]\s*(?:₹|Rs\.?|INR)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i);
      if (p2) {
        name = p2[1].trim();
        quantity = parseFloat(p2[2]);
        unitPrice = cleanPrice(p2[3]);
      }
    }

    if (!name || isNaN(quantity) || isNaN(unitPrice)) {
      const p3 = line.match(/^(\d+(?:\.\d+)?)\s*(?:x|pcs|mtr|set|nos|units)?\s*[:|x@-]?\s*(.+?)\s+(?:[@x|]\s*)?(?:₹|Rs\.?|INR)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)$/i);
      if (p3) {
        quantity = parseFloat(p3[1]);
        name = p3[2].trim();
        unitPrice = cleanPrice(p3[3]);
      }
    }

    if (!name || isNaN(quantity) || isNaN(unitPrice)) {
      const tokens = line.split(/\s+/);
      const numTokens = [];
      const textTokens = [];

      for (let i = 0; i < tokens.length; i++) {
        const num = cleanPrice(tokens[i]);
        if (!isNaN(num) && /^\d+(?:[.,]\d+)?$/.test(tokens[i].replace(/[₹$,]/g, '').replace(/rs\.?/gi, '').replace(/inr/gi, '').replace(/-/g, ''))) {
          numTokens.push({ num, raw: tokens[i], idx: i });
        } else {
          textTokens.push(tokens[i]);
        }
      }

      if (numTokens.length >= 2) {
        let candidateName = textTokens.join(' ').replace(/^[\d\.\)-]+/, '').trim();
        if (candidateName.length < 2) {
          candidateName = pendingName;
        }

        if (candidateName.length >= 2) {
          let found = false;
          for (let i = 0; i <= numTokens.length - 3; i++) {
            const a = numTokens[i].num;
            const b = numTokens[i+1].num;
            const c = numTokens[i+2].num;
            
            if (a > 0 && b >= 0 && Math.abs(a * b - c) < 5) {
              name = candidateName;
              quantity = a;
              unitPrice = b;
              found = true;
              break;
            } else if (b > 0 && a >= 0 && Math.abs(a * b - c) < 5) {
              name = candidateName;
              quantity = b;
              unitPrice = a;
              found = true;
              break;
            }
          }
          
          if (!found) {
            const a = numTokens[numTokens.length - 2].num;
            const b = numTokens[numTokens.length - 1].num;
            if (a > 0 && b >= 0) {
              name = candidateName;
              quantity = a;
              unitPrice = b;
            }
          }

          if (name) {
            pendingName = ''; 
          }
        }
      } else {
        if (!isExcludedHeaderOrFooter(line)) {
          pendingName = pendingName ? pendingName + ' ' + line : line;
          if (pendingName.length > 150) pendingName = line;
        }
      }
    }

    if (
      name &&
      name.length >= 2 &&
      !isNaN(quantity) &&
      quantity > 0 &&
      !isNaN(unitPrice) &&
      unitPrice >= 0 &&
      !isExcludedHeaderOrFooter(name)
    ) {
      const key = `${name.toLowerCase()}_${quantity}_${unitPrice}`;
      if (!seenNames.has(key)) {
        seenNames.add(key);
        items.push({
          material_name_raw: name,
          quantity: Math.round(quantity * 100) / 100,
          unit_price: Math.round(unitPrice * 100) / 100
        });
      }
    }
  }

  return items;
}

async function extractFromPdf(fileSource) {
  let buffer;
  if (Buffer.isBuffer(fileSource)) {
    buffer = fileSource;
  } else if (typeof fileSource === 'string') {
    buffer = fs.readFileSync(fileSource);
  } else {
    throw new Error('Unsupported PDF source for extraction');
  }

  let text = '';
  try {
    const data = await pdfParse(buffer);
    text = (data && data.text) ? data.text : '';
  } catch (err) {
    console.warn('PDF text extraction warning (scanned or complex PDF):', err.message);
  }

  return {
    raw_text: text,
    po_number: extractPoNumber(text),
    line_items: extractLineItems(text)
  };
}

module.exports = { extractFromPdf };