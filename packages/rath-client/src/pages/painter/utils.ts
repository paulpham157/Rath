import produce from 'immer';
import { View, Changeset, tupleid } from 'vega';
import { type ISemanticType } from '@kanaries/loa';
import { IRow, IVegaSubset, PAINTER_MODE } from '../../interfaces';
import { LABEL_FIELD_KEY, LABEL_INDEX } from './constants';

export function isContinuous (fieldType: ISemanticType) {
    return fieldType === 'quantitative' || fieldType === 'temporal';
}

export function debounceAsync<T> (handler: (...args: any) => T | Promise<T>, delay_ms: number = 200) {
    let timer: any;
    let last_reject: ((reason: any) => void) | undefined;
    return (...args: any) => {
        if (timer !== undefined) {
            clearTimeout(timer);
            if (last_reject && last_reject instanceof Function) {
                last_reject("overlaid");
            }
            timer = last_reject = undefined;
        }
        return new Promise((resolve, reject) => {
            last_reject = reject;
            // _change_timer = setTimeout(async () => { resolve(await handler())}, delay_ms);
            timer = setTimeout(() => {
                Promise.resolve(handler(...args)).then(res => resolve(res))
            }, delay_ms)
        });
    }
}

export function debounce (handler: (...args: any) => void, delay_ms: number = 200) {
    let timer: any;
    return (...args: any) => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        timer = setTimeout(() => handler(...args), delay_ms);
    }
}

type IPainterKey = `_painter_${string}`;
export class VegaViewChanges {
    private changes: Changeset;
    private rem: Set<number>;
    private indexKey: (row: IRow) => any;
    [key: IPainterKey ]: any;
    // private _change_timer?: any;
    // private _last_reject?: (reason: any) => void;
    /**
     * 
     * @param view
     * @param tableName 
     * @param indexKey The key of index to distinguish different discords. \
     *  Use vega's `tupleid(row)` if indexKey is not specified.
     */
    constructor (private view: View, private tableName: string, indexKey?: string) {
        if (indexKey === undefined) this.indexKey = tupleid;
        else this.indexKey = (row: IRow) => row[indexKey];
        this.changes = view.changeset();
        this.rem = new Set();
    }

    modify (mutIndices: Set<number>, mutValues: IRow[]) {
    // modify (tuple: any, field?: string, value?: any) {
        // this.changes = this.changes.modify(tuple, field, value);
        let indices = new Set(mutIndices);
        this.changes = this.changes.remove((v: IRow) => indices.has(this.indexKey(v))).insert(mutValues);
        return this;
    }

    removeAll (tuples: any) {
        this.changes = this.changes.remove(() => true);
    }

    remove (mutIndices: Iterable<number>) {
        let indices = new Set(mutIndices);
        this.changes = this.changes.remove((v: IRow) => indices.has(this.indexKey(v)));
        for (let i of mutIndices) this.rem.add(i);
        return this;
    }

    insert (mutValues: IRow[]) {
        this.changes = this.changes.insert(mutValues);
        return this;
    }

    /**
     * Run changes and returns the last removed indices.
     * @param delay_ms delay of debouncing in `ms`. default to 0.
     * @returns The last removed indices.
     */
    async runAsync(): Promise<Set<number>> {
        const res = this.rem;
        this.rem = new Set();
        this.view.change(this.tableName, this.changes)
        this.changes = this.view.changeset();
        this.view = await this.view.runAsync();
        return res;
    }
    /**
     * Run changes after `delay_ms` and returns a `Promise`.\
     * Only resolves when actually been executed.
     * @param delay_ms delay of debouncing in `ms`. default to 0.
     * @returns The last removed indices.
     */
    runAsyncDelayed(delay_ms: number = 0): Promise<Set<number>> {
        const TIMER_KEY: IPainterKey = '_painter_change_timer';
        const REJECT_KEY: IPainterKey = '_painter_last_reject';
        if (this[TIMER_KEY] !== undefined) {
            clearTimeout(this[TIMER_KEY]);
            if (this[REJECT_KEY] && this[REJECT_KEY] instanceof Function) {
                this[REJECT_KEY]("overlaid");
                this[REJECT_KEY] = undefined;
            }
            this[TIMER_KEY] = undefined;
        }
        return new Promise((resolve, reject) => {
            const doChanges = () => this.runAsync().then(res => resolve(res));
            this[REJECT_KEY] = reject;
            this[TIMER_KEY] = setTimeout(doChanges, delay_ms);
        });
    }

}

export function batchMutInRange (mutData: IRow, field: string, range: [number, number], key: string, value: any) {
    for (let i = 0; i < mutData.length; i++) {
        if (mutData[i][field] >= range[0] && mutData[i][field] <= range[1]) {
            mutData[i][key] = value;
        }
    }
}

interface BatchMutInCircleProps {
    mutData: IRow;
    fields: [string, string];
    point: [number, number];
    r: number;
    a: number;
    b: number;
    key: string;
    value: any;
    datum: IRow;
    indexKey: string;
    limitFields: string[];
    painterMode?: PAINTER_MODE
}
/** @deprecated to {import('vega-painter-renderer').paint} */
export function batchMutInCircle (props: BatchMutInCircleProps) {
    const {
        mutData,
        fields,
        point,
        a,
        b,
        r,
        key,
        value,
        indexKey,
        datum,
        painterMode = PAINTER_MODE.COLOR,
        limitFields = []
    } = props;
    const mutIndices = new Set();
    const mutValues: IRow[] = [];
    const limitValueMap: Map<any, any> = new Map();
    for (let lf of limitFields) {
        limitValueMap.set(lf, datum[lf]);
    }
    for (let i = 0; i < mutData.length; i++) {
        if (((mutData[i][fields[0]] - point[0]) ** 2) / (a ** 2) + ((mutData[i][fields[1]] - point[1]) ** 2) / (b ** 2) <= (r ** 2)) {
            let drop = false;
            for (let lf of limitFields) {
                if (limitValueMap.get(lf) !== mutData[i][lf]) {
                    drop = true;
                    break;
                }
            }
            if (drop) continue;
            if (painterMode === PAINTER_MODE.COLOR) {
                if (mutData[i][key] !== value) {
                    mutData[i][key] = value;
                    mutValues.push(mutData[i])
                    mutIndices.add(mutData[i][indexKey])
                }
            } else if (painterMode === PAINTER_MODE.ERASE) {
                mutValues.push(mutData[i])
                mutIndices.add(mutData[i][indexKey])
            }
        }
    }
    return {
        mutIndices,
        mutValues
    }
}

interface BatchMutInCatRangeProps {
    mutData: IRow;
    fields: [string, string];
    point: [any, number];
    r: number;
    range: number;
    key: string;
    value: any;
    indexKey: string;
}
/** @deprecated to {import('vega-painter-renderer').paint} */
export function batchMutInCatRange (props: BatchMutInCatRangeProps) {
    const {
        mutData,
        fields,
        point,
        r,
        range,
        key,
        value,
        indexKey
    } = props;
    const mutIndices = new Set();
    const mutValues: IRow[] = [];
    for (let i = 0; i < mutData.length; i++) {
        if (mutData[i][fields[0]] === point[0]) {
            if (Math.abs(mutData[i][fields[1]] - point[1]) < r * Math.sqrt(range)) {
                if (mutData[i][key] !== value) {
                    mutData[i][key] = value;
                    mutValues.push(mutData[i])
                    mutIndices.add(mutData[i][indexKey])
                }
            }
        }
    }
    return {
        mutIndices,
        mutValues
    }
}

export function labelingData (data: IRow[], initValue: any) {
    return data.map((r, i) => {
        return { ...r, [LABEL_FIELD_KEY]: initValue, [LABEL_INDEX]: i };
    })
}

/**
 * It is not a normal debounce, I develop it for a temp special case.
 * @param initAction 
 * @param func 
 * @param waitFor 
 * @returns 
 */
export const debounceShouldNeverBeUsed = <F extends ((...args: any) => any)>(initAction: F, func: F, waitFor: number) => {
    let timeout: number = 0

    const debounced = (...args: any) => {
        initAction(...args)
        clearTimeout(timeout)
        setTimeout(() => func(...args), waitFor)
    }
    
    return debounced as (...args: Parameters<F>) => ReturnType<F>
}

export function clearAggregation (spec: IVegaSubset): IVegaSubset {
    const nextSpec = produce<IVegaSubset>(spec, draft => {
        Object.values(draft.encoding).forEach(ch => {
            if (ch.aggregate) ch.aggregate = undefined;
        })
        switch (draft.mark) {
            case 'area':
            case 'line':
            case 'boxplot':
                draft.mark = 'point';
                break;
            default:
                draft.mark = 'tick'
        }
    })
    return nextSpec;
}