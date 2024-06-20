import k8s from '@kubernetes/client-node';
import net from 'net';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const api = kc.makeApiClient(k8s.CoreV1Api);
const dynamicApi = kc.makeApiClient(k8s.KubernetesObjectApi);
const portForwardApi = new k8s.PortForward(kc);

export async function applyManifest(manifest, namespace = 'default') {
    if (!manifest.metadata) {
        manifest.metadata = {};
    }
    manifest.metadata.namespace = namespace;

    try {
        await dynamicApi.create(manifest);
    } catch (err) {
        if (err.response && err.response.statusCode === 409) {
            await dynamicApi.replace(manifest)
        } else {
            throw err;
        }
    }
}

export async function deleteManifest(manifest, namespace = 'default') {
    if (!manifest.metadata) {
        manifest.metadata = {};
    }
    manifest.metadata.namespace = namespace;

    await dynamicApi.delete(manifest);
}

export async function portForward(pod, targetPort, localPort, namespace = 'default') {
    const server = net.createServer((socket) => {
        portForwardApi.portForward(namespace, pod, [targetPort], socket, null, socket);
    });

    server.listen(localPort, '127.0.0.1');

    return server;
}

export async function listPods(labelSelector, namespace = 'default') {
    return await api.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, labelSelector);
}