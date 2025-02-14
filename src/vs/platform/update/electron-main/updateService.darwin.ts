/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as electron from 'electron';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { memoize } from 'vs/base/common/decorators';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILifecycleMainService } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { State, IUpdate, StateType, UpdateType } from 'vs/platform/update/common/update';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ILogService } from 'vs/platform/log/common/log';
import { AbstractUpdateService, createUpdateURL, UpdateNotAvailableClassification } from 'vs/platform/update/electron-main/abstractUpdateService';
import { IRequestService } from 'vs/platform/request/common/request';

export class DarwinUpdateService extends AbstractUpdateService {

	_serviceBrand: undefined;

	private disposables: IDisposable[] = [];

	@memoize private get onRawError(): Event<string> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'error', (_, message) => message); }
	@memoize private get onRawUpdateNotAvailable(): Event<void> { return Event.fromNodeEventEmitter<void>(electron.autoUpdater, 'update-not-available'); }
	@memoize private get onRawUpdateAvailable(): Event<IUpdate> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'update-available', (_, url, version) => ({ url, version, productVersion: version })); }
	@memoize private get onRawUpdateDownloaded(): Event<IUpdate> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'update-downloaded', (_, releaseNotes, version, date) => ({ releaseNotes, version, productVersion: version, date })); }

	constructor(
		@ILifecycleMainService lifecycleService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService
	) {
		super(lifecycleService, configurationService, environmentService, requestService, logService);
		this.onRawError(this.onError, this, this.disposables);
		this.onRawUpdateAvailable(this.onUpdateAvailable, this, this.disposables);
		this.onRawUpdateDownloaded(this.onUpdateDownloaded, this, this.disposables);
		this.onRawUpdateNotAvailable(this.onUpdateNotAvailable, this, this.disposables);
	}

	private onError(err: string): void {
		this.logService.error('UpdateService error:', err);

		// only show message when explicitly checking for updates
		const shouldShowMessage = this.state.type === StateType.CheckingForUpdates ? !!this.state.context : true;
		const message: string | undefined = shouldShowMessage ? err : undefined;
		this.setState(State.Idle(UpdateType.Archive, message));
	}

	protected buildUpdateFeedUrl(quality: string): string | undefined {
		const url = createUpdateURL('darwin', quality);
		try {
			electron.autoUpdater.setFeedURL({ url });
		} catch (e) {
			// application is very likely not signed
			this.logService.error('Failed to set update feed URL', e);
			return undefined;
		}
		return url;
	}

	protected doCheckForUpdates(context: any): void {
		this.setState(State.CheckingForUpdates(context));
		electron.autoUpdater.checkForUpdates();
	}

	private onUpdateAvailable(update: IUpdate): void {
		if (this.state.type !== StateType.CheckingForUpdates) {
			return;
		}

		this.setState(State.Downloading(update));
	}

	private onUpdateDownloaded(update: IUpdate): void {
		if (this.state.type !== StateType.Downloading) {
			return;
		}

		type UpdateDownloadedClassification = {
			version: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
		};
		this.telemetryService.publicLog2<{ version: String }, UpdateDownloadedClassification>('update:downloaded', { version: update.version });

		this.setState(State.Ready(update));
	}

	private onUpdateNotAvailable(): void {
		if (this.state.type !== StateType.CheckingForUpdates) {
			return;
		}
		this.telemetryService.publicLog2<{ explicit: boolean }, UpdateNotAvailableClassification>('update:notAvailable', { explicit: !!this.state.context });

		this.setState(State.Idle(UpdateType.Archive));
	}

	protected doQuitAndInstall(): void {
		this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
		electron.autoUpdater.quitAndInstall();
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}
