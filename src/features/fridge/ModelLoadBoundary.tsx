import { Component, type ReactNode } from 'react';
import { Html, useGLTF } from '@react-three/drei';
import i18n from '../../locales/i18n';

export function ModelPlaceholder({ failed = false }: { failed?: boolean }) {
    return <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.3, 0.7, 0.3]} />
        <meshStandardMaterial color={failed ? '#ef4444' : '#94a3b8'} wireframe />
    </mesh>;
}

export class ModelLoadBoundary extends Component<{ path: string; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() {
        if (!this.state.failed) return this.props.children;
        return <>
            <ModelPlaceholder failed />
            <Html position={[0, 0.9, 0]} center>
                <button type="button" title={i18n.t('msc_model_reload')} aria-label={i18n.t('msc_model_reload')} className="h-8 w-8 rounded border bg-white text-lg text-red-700" onClick={() => {
                    useGLTF.clear(this.props.path);
                    this.setState({ failed: false });
                }}>↻</button>
            </Html>
        </>;
    }
}
