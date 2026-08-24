-- 시약 템플릿을 A–D 네 글자 체계로 통일 (솔벤트 캔 제거 반영)
-- A=갈색병, B=플라스틱, C=바이알박스, D=유리병(GLB)
-- 구형: C=솔벤트캔, D=바이알박스, E=유리병

UPDATE cabinet_items
SET template = CASE template
    WHEN 'C' THEN 'A'
    WHEN 'D' THEN 'C'
    WHEN 'E' THEN 'D'
    ELSE template
END
WHERE template IN ('C', 'D', 'E');
