export const extractCasNumber = (text: string): string | null => {
    // CAS RegEx: 2-7 digits, hyphen, 2 digits, hyphen, 1 digit
    // e.g., 67-64-1
    const casRegex = /\b\d{2,7}-\d{2}-\d\b/g;
    const matches = text.match(casRegex);
    return matches ? matches[0] : null;
};

export const sanitizeSearchTerm = (text: string): string => {
    // Remove common OCR noise, keep Korean, English, numbers, spaces
    return text
        .replace(/[^\w\s가-힣-]/g, ' ') // Keep alphanumeric, Korean, spaces, hyphen
        .replace(/\s+/g, ' ')           // Collapse multiple spaces
        .trim();
};
