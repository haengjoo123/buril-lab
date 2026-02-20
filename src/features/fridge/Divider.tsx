import React from 'react';

interface DividerProps {
    position: number; // 0-100%
    shelfWidth: number;
    shelfDepth: number;
    height: number; // 칸 공간 높이 (선반 두께 제외한 gap)
    /** PLACE 모드에서 비선택 시 흐리게 */
    dimmed?: boolean;
}

export const Divider: React.FC<DividerProps> = ({ position, shelfWidth, shelfDepth, height, dimmed = false }) => {
    const x = (position / 100) * shelfWidth - shelfWidth / 2;
    const y = height / 2;
    const opacity = dimmed ? 0.4 : 0.8;

    return (
        <mesh position={[x, y, 0]} castShadow>
            <boxGeometry args={[0.05, height, shelfDepth]} />
            <meshStandardMaterial color="#94a3b8" transparent opacity={opacity} />
        </mesh>
    );
};
