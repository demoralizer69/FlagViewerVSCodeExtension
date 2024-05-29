import * as vscode from 'vscode';
import { transformText, getProcessedOutput} from './textTransformer';
import path from 'path';

export default class Provider implements vscode.TextDocumentContentProvider {
    static scheme = 'dynamic-flag-view';
    private _onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    private _filePathToFlagViewUriMap = new Map<string, Set<vscode.Uri>>();
    private _subscriptions : vscode.Disposable[] = [];
    onDidChange = this._onDidChangeEmitter.event;
    async provideTextDocumentContent(uri: vscode.Uri) {
        const [underlyingFilePath, flagsArr, expandDefines] = Provider._decode(uri);
        const underlyingDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(underlyingFilePath));
        const transformedText = transformText(underlyingDocument.getText(), expandDefines);
        if(!this._filePathToFlagViewUriMap.has(underlyingFilePath)) {
            this._filePathToFlagViewUriMap.set(underlyingFilePath, new Set<vscode.Uri>());
        }
        this._filePathToFlagViewUriMap.get(underlyingFilePath)?.add(uri);
        return getProcessedOutput(transformedText, flagsArr, expandDefines);
    }

    constructor() {
        const closeEventListenerDisposable = vscode.workspace.onDidCloseTextDocument(
            doc => this._filePathToFlagViewUriMap.get(doc.uri.path)?.delete(doc.uri)
        );

        const textChangeEventListenerDisposable = vscode.workspace.onDidChangeTextDocument(doc => {
            const docUri = doc.document.uri;
            this._filePathToFlagViewUriMap.get(docUri.path)?.forEach(
                uri => this._onDidChangeEmitter.fire(uri)
            );
        });

        this._subscriptions.push(
            closeEventListenerDisposable,
            textChangeEventListenerDisposable,
        );
    }

    dispose() {
        this._filePathToFlagViewUriMap.clear();
        this._onDidChangeEmitter.dispose();
        this._subscriptions.forEach(s => s.dispose());
    }

    static encode(underlyingUri : vscode.Uri, flagsArr : string[], expandDefines : boolean) : vscode.Uri {
        return underlyingUri.with({
            scheme : Provider.scheme,
            authority : expandDefines.toString(),
            query : flagsArr.join(','),
        });
    }

    private static _decode(uri: vscode.Uri) : [string, string[], boolean] {
        console.log(uri.path, uri.query.split(','), JSON.parse(uri.authority));
        return [uri.path, uri.query.split(','), JSON.parse(uri.authority)];
    }
}
