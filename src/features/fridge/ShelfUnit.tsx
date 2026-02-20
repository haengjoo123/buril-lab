import React, { useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { ShelfData } from '../../types/fridge';
import { useFridgeStore } from '../../store/fridgeStore';
import { ReagentItem, ItemGeometry } from './ReagentItem';
import { Divider } from './Divider';
import { checkCompatibility } from '../../utils/compatibilityChecker';
import { Html } from '@react-three/drei';

interface ShelfUnitProps {
    shelf: ShelfData;
    position: [number, number, number];
    shelfWidth: number;
    shelfDepth: number;
    cellHeight: number;
    onShelfFocus?: (shelfLocalY: number) => void;
    shelfHeight?: number;
    /** PLACE 모드에서 비선택 선반 시각적 비활성화 */
    isDimmed?: boolean;
}

const DEFAULT_SHELF_HEIGHT = 0.2;

interface MinimalChemicalData {
    properties?: { ph?: number;[key: string]: unknown };
    ghs?: { hazardStatements?: string[];[key: string]: unknown };
    [key: string]: unknown;
}

export const ShelfUnit: React.FC<ShelfUnitProps> = ({
    shelf,
    position,
    shelfWidth,
    shelfDepth,
    cellHeight,
    onShelfFocus,
    shelfHeight = DEFAULT_SHELF_HEIGHT,
    isDimmed = false
}) => {
    const { draggedTemplate, draggedItem, shelves, checkCollision, placeReagent, moveReagent, setDraggedTemplate, setDraggedItem } = useFridgeStore();
    const [ghostPos, setGhostPos] = useState<number | null>(null);
    const [ghostDepthPos, setGhostDepthPos] = useState<number>(50);
    const [isValid, setIsValid] = useState(true);
    const [warning, setWarning] = useState<string | null>(null);

    const draggedPlacement = draggedItem
        ? shelves.flatMap(s => s.items).find(i => i.id === draggedItem.id)
        : null;
    const isPlacedItemDrag = !!draggedItem && !!draggedPlacement;

    const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
        const dragWidth = draggedTemplate?.width ?? draggedPlacement?.width;
        if (!draggedTemplate && !isPlacedItemDrag) return;
        if (!dragWidth) return;
        e.stopPropagation();

        const localX = e.point.x - position[0];
        const localZ = e.point.z - position[2];
        let pct = ((localX + shelfWidth / 2) / shelfWidth) * 100;
        pct = pct - dragWidth / 2;
        if (pct < 0) pct = 0;
        if (pct + dragWidth > 100) pct = 100 - dragWidth;

        const depthPct = ((localZ + shelfDepth / 2) / shelfDepth) * 100;
        const depthClamped = Math.max(0, Math.min(100, depthPct));

        setGhostPos(pct);
        setGhostDepthPos(depthClamped);

        const ignoreId = isPlacedItemDrag ? draggedItem!.id : undefined;
        const templateType = draggedTemplate?.type ?? draggedPlacement?.template;
        const collision = checkCollision(shelf.id, pct, dragWidth, ghostDepthPos, templateType, ignoreId);
        setIsValid(!collision);

        if (!collision && draggedTemplate?.chemicalData) {
            const neighbors = shelf.items.filter(i => {
                const dist = Math.min(
                    Math.abs(i.position - (pct + draggedTemplate.width)),
                    Math.abs((i.position + i.width) - pct)
                );
                return dist < 5; // 5% proximity threshold
            });

            checkCompatibility([
                {
                    chemical: draggedTemplate.chemicalData || {
                        name: draggedTemplate.name,
                        ghs: { hazardStatements: [] },
                        properties: { ph: 7 }
                    },
                    quantity: 1
                } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
                ...neighbors.map(n => ({
                    chemical: {
                        name: n.name,
                        ghs: { hazardStatements: n.hCodes || [] },
                        properties: { ph: n.isAcidic ? 1 : (n.isBasic ? 14 : 7) }
                    },
                    quantity: 1
                } as any)) // eslint-disable-line @typescript-eslint/no-explicit-any
            ]);

            let warnMsg = null;
            // Iterate over neighbors logic... 
            // Simplification for prototype:
            // If we have `isAcidic` and neighbor is `isBasic`, trigger warning.
            // We don't have the full rule engine unless we store full data.
            // Let's implement a simple Acid-Base check here using the flags.
            const chem = draggedTemplate.chemicalData as MinimalChemicalData | undefined;
            const isAcid = (chem?.properties?.ph ?? 7) < 7;
            const isBase = (chem?.properties?.ph ?? 7) > 10;
            // Also check hCodes if available?
            for (const n of neighbors) {
                if (isAcid && n.isBasic) warnMsg = "Acid + Base Incompatible!";
                if (isBase && n.isAcidic) warnMsg = "Base + Acid Incompatible!";
            }
            setWarning(warnMsg);
        } else {
            setWarning(null);
        }
    };

    const handlePointerLeave = () => {
        setGhostPos(null);
        setWarning(null);
        document.body.style.cursor = 'default';
    };

    const handlePointerEnter = () => {
        if (!draggedTemplate && !draggedItem) document.body.style.cursor = 'pointer';
    };

    const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
        if (!draggedTemplate && !draggedItem) {
            e.stopPropagation();
            onShelfFocus?.(position[1]);
            return;
        }
        // 시약 선택 상태에서도, 호버 없이 선반만 클릭한 경우 포커스 처리
        if (ghostPos === null || !isValid) {
            e.stopPropagation();
            onShelfFocus?.(position[1]);
            return;
        }
        e.stopPropagation();

        if (isPlacedItemDrag && draggedItem) {
            moveReagent(draggedItem.id, shelf.id, ghostPos, ghostDepthPos);
            setDraggedItem(null);
            setGhostPos(null);
            document.body.style.cursor = 'default';
            return;
        }

        if (!draggedTemplate) return;

        const chem = draggedTemplate.chemicalData as any;
        placeReagent(shelf.id, {
            id: '', // Generated in store
            reagentId: 'new-id', // TODO: Real ID
            name: draggedTemplate.name || 'Unknown',
            position: ghostPos,
            depthPosition: ghostDepthPos,
            width: draggedTemplate.width,
            template: draggedTemplate.type,
            isAcidic: (chem?.properties?.ph ?? 7) < 7,
            isBasic: (chem?.properties?.ph ?? 7) > 10,
            hCodes: chem?.ghs?.hazardStatements || [],
            // Extra data for editing
            chemId: chem?.koshaId,
            casNo: chem?.casNumber,
            notes: ''
        });

        setDraggedTemplate(null);
        setGhostPos(null);
        document.body.style.cursor = 'default';
    };

    const shelfColor = ghostPos !== null ? '#f8f6f3' : '#e8e6e1';
    const shelfOpacity = isDimmed ? 0.35 : 1;

    return (
        <group position={position}>
            {/* Shelf Base - Drop Target */}
            <mesh
                receiveShadow
                position={[0, -shelfHeight / 2, 0]}
                onPointerMove={handlePointerMove}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
                onPointerUp={handlePointerUp}
            >
                <boxGeometry args={[shelfWidth, shelfHeight, shelfDepth]} />
                <meshStandardMaterial key={isDimmed ? 'dimmed' : 'normal'} color={shelfColor} transparent opacity={shelfOpacity} depthWrite={!isDimmed} />
            </mesh>

            {/* Items */}
            {shelf.items.map((item) => (
                <ReagentItem
                    key={item.id}
                    item={item}
                    shelfWidth={shelfWidth}
                    shelfDepth={shelfDepth}
                    dimmed={isDimmed}
                />
            ))}

            {/* Ghost Item - 새 시약 배치 또는 기존 시약 이동 */}
            {((draggedTemplate || isPlacedItemDrag) && ghostPos !== null) && (
                <group
                    position={[
                        ((ghostPos + (draggedTemplate?.width ?? draggedPlacement!.width) / 2) / 100) * shelfWidth - shelfWidth / 2,
                        0,
                        (ghostDepthPos / 100) * shelfDepth - shelfDepth / 2
                    ]}
                    onPointerUp={handlePointerUp}
                >
                    <ItemGeometry type={(draggedTemplate?.type ?? draggedPlacement!.template) as string} color={isValid ? (warning ? '#fbbf24' : '#4ade80') : '#ef4444'} opacity={0.6} />
                    {warning && (
                        <Html position={[0, 1.5, 0]} center>
                            <div className="bg-red-500 text-white text-xs px-2 py-1 rounded shadow whitespace-nowrap animate-pulse">
                                ⚠️ {warning}
                            </div>
                        </Html>
                    )}
                </group>
            )}

            {/* Dividers */}
            {shelf.dividers.map((pos, index) => (
                <Divider
                    key={`${shelf.id}-div-${index}`}
                    position={pos}
                    shelfWidth={shelfWidth}
                    shelfDepth={shelfDepth}
                    height={cellHeight}
                    dimmed={isDimmed}
                />
            ))}
        </group>
    );
};
