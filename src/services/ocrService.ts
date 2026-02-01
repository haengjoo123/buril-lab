import Tesseract from 'tesseract.js';

export const performOcr = async (imageSrc: string): Promise<string> => {
    try {
        const result = await Tesseract.recognize(
            imageSrc,
            'eng', // English is standard for CAS and Chemical names
            {
                logger: m => console.log('[OCR Log]', m), // Optional logger suitable for dev
                // errorHandler?
            }
        );

        return result.data.text;
    } catch (error) {
        console.error('OCR Error:', error);
        throw new Error('Failed to process image');
    }
};
