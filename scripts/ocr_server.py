import uvicorn
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from paddleocr import PaddleOCR
import numpy as np
import cv2
import base64
import io
from PIL import Image

import os

# Disable OneDNN to avoid "ConvertPirAttribute2RuntimeAttribute" error
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["FLAGS_enable_pir_api"] = "0" # Try disabling PIR if possible, though mkldnn=0 is usually enough

app = FastAPI()

# Allow CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize PaddleOCR with Korean language support
# This will download the model on first run
# enable_mkldnn=False to avoid OneDNN errors
ocr = PaddleOCR(use_angle_cls=True, lang='korean', enable_mkldnn=False)

@app.get("/")
def read_root():
    return {"status": "running", "service": "Buril-Lab OCR Server"}

@app.post("/ocr")
async def process_ocr(image: UploadFile = File(...)):
    try:
        # Read image file
        image_bytes = await image.read()
        
        # Convert to numpy array for PaddleOCR
        image_pil = Image.open(io.BytesIO(image_bytes))
        image_np = np.array(image_pil)
        
        # PaddleOCR expects BGR for OpenCV or RGB? 
        # Actually PaddleOCR read image via cv2.imread which is BGR. 
        # PIL is RGB. Let's convert if necessary, but PaddleOCR handles it well usually.
        # Explicit conversion to BGR just in case to match cv2 behavior
        image_np = cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR)

        # Perform OCR
        # We initialized PaddleOCR with use_angle_cls=True, so angle classification is enabled by default.
        # Passing cls=True to ocr() explicitly causes an error in some versions.
        result = ocr.ocr(image_np)
        
        print(f"DEBUG: Result type: {type(result)}")
        print(f"DEBUG: Result raw: {result}")

        # Parse result
        # Parse result
        identified_text = []
        if result and len(result) > 0:
            first_item = result[0]
            
            # Case 1: New behavior (PaddleX/Dict-like) - Check for 'rec_texts'
            rec_texts = None
            try:
                # Try dict access
                if hasattr(first_item, '__getitem__'):
                    try:
                        rec_texts = first_item['rec_texts']
                    except (KeyError, TypeError, IndexError):
                        pass
                
                # Try attribute access
                if rec_texts is None and hasattr(first_item, 'rec_texts'):
                    rec_texts = first_item.rec_texts
            except Exception:
                pass

            if rec_texts:
                identified_text = rec_texts
            
            # Case 2: Old behavior (List of results) - [[box, (text, score)], ...]
            elif isinstance(first_item, list):
                 for line in first_item:
                    if isinstance(line, list) and len(line) >= 2:
                        text = line[1][0]
                        identified_text.append(text)
        
        full_text = " ".join(identified_text)
        return {"text": full_text, "success": True}

    except Exception as e:
        print(f"Error: {e}")
        return {"text": "", "success": False, "error": str(e)}

if __name__ == "__main__":
    print("Starting OCR Server on port 8000...")
    print("Make sure to install requirements: pip install paddlepaddle paddleocr fastapi uvicorn python-multipart opencv-python pillow")
    uvicorn.run(app, host="0.0.0.0", port=8000)
