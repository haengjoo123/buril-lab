import Tesseract from 'tesseract.js';

/**
 * 이미지 전처리: 그레이스케일 + 대비 향상 + 샤프닝
 * Canvas API를 사용하여 OCR 인식률 향상
 */
const preprocessImage = async (imageSrc: string): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                resolve(imageSrc); // 실패 시 원본 반환
                return;
            }

            // 해상도 유지
            canvas.width = img.width;
            canvas.height = img.height;

            // 원본 이미지 그리기
            ctx.drawImage(img, 0, 0);

            // 이미지 데이터 가져오기
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // 1. 대비 향상 (그레이스케일 변환 없이)
            const contrastFactor = 1.3; // 대비 강도 (1.0 = 변화 없음)
            const brightness = 10; // 밝기 약간 증가

            for (let i = 0; i < data.length; i += 4) {
                // 대비 향상 + 밝기 조절 (색상 유지)
                for (let j = 0; j < 3; j++) {
                    let pixel = data[i + j];
                    pixel = ((pixel - 128) * contrastFactor) + 128 + brightness;
                    data[i + j] = Math.max(0, Math.min(255, pixel));
                }
                // Alpha는 유지
            }

            ctx.putImageData(imageData, 0, 0);

            // 전처리된 이미지를 base64로 반환
            resolve(canvas.toDataURL('image/png'));
        };

        img.onerror = () => {
            console.warn('[OCR] Image preprocessing failed, using original');
            resolve(imageSrc);
        };

        img.src = imageSrc;
    });
};

// Local Python Server URL
const OCR_SERVER_URL = 'http://localhost:8000/ocr';

export interface OcrResult {
    text: string;
    source: 'PaddleOCR' | 'Tesseract';
}

// Helper to resize image for server upload
const resizeImageForServer = async (imageSrc: string, maxWidth: number = 1600): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Canvas to Blob failed'));
            }, 'image/jpeg', 0.85);
        };
        img.onerror = reject;
        img.src = imageSrc;
    });
};

export const performOcr = async (imageSrc: string): Promise<OcrResult> => {
    // 1. Try Local PaddleOCR Server first
    try {
        console.log('[OCR] Trying local PaddleOCR server...');

        // Resize image for performance (max width 1600px)
        // This dramatically reduces CPU time on the server compared to sending full 4K
        const resizedBlob = await resizeImageForServer(imageSrc, 1600);

        const formData = new FormData();
        formData.append('image', resizedBlob, 'capture.jpg');

        // Set a comfortable timeout (60 seconds)
        // Even with resizing, CPU inference can be slow on some machines
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const response = await fetch(OCR_SERVER_URL, {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            // console.log('[OCR] Server Response Data:', data); 

            if (data.success && data.text) {
                console.log('[OCR] Local Server Success:', data.text.substring(0, 50) + '...');
                return { text: data.text, source: 'PaddleOCR' };
            } else {
                console.warn('[OCR] Server invalid response:', { success: data.success });
            }
        } else {
            const errorData = await response.text();
            console.warn(`[OCR] Server responded with status: ${response.status}`, errorData);
        }
    } catch (serverError) {
        console.log('[OCR] Local server unreachable/failed, falling back to Tesseract. Reason:', serverError);
    }

    // 2. Fallback to Tesseract (Existing Logic)
    try {
        // 1. 이미지 전처리
        console.log('[OCR] Preprocessing image...');
        const processedImage = await preprocessImage(imageSrc);
        console.log('[OCR] Preprocessing complete');

        // 2. Tesseract 설정 최적화
        const result = await Tesseract.recognize(
            processedImage,
            'eng+kor', // English for CAS, Korean for names
            {
                logger: m => console.log('[OCR Log]', m),
            }
        );

        return { text: result.data.text, source: 'Tesseract' };
    } catch (error) {
        console.error('OCR Error:', error);
        throw new Error('Failed to process image');
    }
};

/**
 * CAS 번호 전용 OCR - 숫자와 하이픈만 인식
 * 더 정확한 CAS 번호 인식이 필요한 경우 사용
 */
export const performCasOcr = async (imageSrc: string): Promise<string> => {
    try {
        const processedImage = await preprocessImage(imageSrc);

        const worker = await Tesseract.createWorker('eng');

        // CAS 번호에 최적화된 설정
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789-', // 숫자와 하이픈만
            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE, // 단일 라인 모드
        });

        const result = await worker.recognize(processedImage);
        await worker.terminate();

        return result.data.text;
    } catch (error) {
        console.error('CAS OCR Error:', error);
        throw new Error('Failed to process image for CAS');
    }
};
