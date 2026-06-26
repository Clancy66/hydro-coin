import { db } from 'hydrooj';

// 热力图
export class HeatmapModel {
    static async getHeatmap(uid: number) {
        const coll = db.collection('record');

        const rows = await coll.aggregate([
            { $match: { uid } },
            {
                $project: {
                    date: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$judgeAt',
                            timezone: 'Asia/Shanghai',
                        }
                    },
                    status: 1
                }
            },
            {
                $group: {
                    _id: '$date',
                    total: { $sum: 1 },
                }
            }
        ]).toArray();

        const map = new Map(rows.map(r => [r._id, r]));

        const start = new Date();
        start.setMonth(start.getMonth() - 12);

        const end = new Date();

        const data = [];

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {

            const date = d.toISOString().slice(0, 10);
            let weekday = d.getDay();
            weekday = weekday === 0 ? 6 : weekday - 1;

            const r = map.get(date);

            const count = r?.total || 0;

            data.push({
                date,
                count,
            });
        }

        return {
            data
        };
    }
}