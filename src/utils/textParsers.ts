import { extractValidCasNumber } from './casNumber';

export const extractCasNumber = (text: string): string | null => {
    return extractValidCasNumber(text);
};

export const sanitizeSearchTerm = (text: string): string => {
    // Remove common OCR noise, keep Korean, English, numbers, spaces
    return text
        .replace(/[^\w\s가-힣-]/g, ' ') // Keep alphanumeric, Korean, spaces, hyphen
        .replace(/\s+/g, ' ')           // Collapse multiple spaces
        .trim();
};
