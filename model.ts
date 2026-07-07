import { db, Filter, ObjectId } from 'hydrooj';

const coinsCollection = db.collection('coins');
const billsCollection = db.collection('bills');
const goodsCollection = db.collection('goods');
const bagCollection = db.collection('bag');

interface Coins {
    _id?: ObjectId;
    uid: number;        // 用户
    total: number;      // 金币余额
    checkin: number;    // 打卡所得金币总量
    stages: number;     // 竞技所得金币总量
    problems: number;   // 刷题所得金币总量
    bonus: number;      // 额外奖励金币总量
}

interface Bills {
    _id?: ObjectId;
    createAt: Date;     // 操作时间
    rootId: number;     // 操作员
    uid: number;        // 操作对象
    goodsId: string;    // 商品
    coins: number;      // 金币数量
    content: string;    // 操作日志
    check: number;      // 0:待核销, 1:已核销, 2:虚拟商品无需核销
}

interface Goods {
    _id?: ObjectId;
    name: string;       // 商品名
    description: string;// 描述
    price: number;      // 单价
    amount: number;     // 储量
    limit: number;      // 限购, 0:不限购
    imageUrl: string;   // 展示图
    type: number;       // 0:实物, 1:域内首次 AC, 2:热力图, 3:头像框, 4:头像, 5:背景, 6:AC 弹窗
    status: boolean;    // true:上架, false:下架
    sale: number;       // 销量
}

interface Bag {
    _id?: ObjectId;
    uid: number;        // 用户
    goodsId: ObjectId;    // 已购商品
    type: number;       // 商品类别，用于限制同类虚拟商品装配数量
    loaded: boolean;    // false:未装配, true:已装配
}

declare module 'hydrooj' {
    interface Model {
        coins: typeof CoinsModel;
        bills: typeof BillsModel;
        goods: typeof GoodsModel;
        bag: typeof BagModel;
    }
    interface Collections {
        coins: Coins;
        bills: Bills;
        goods: Goods;
        bag: Bag;
    }
}

class CoinsModel {
    static coll = coinsCollection;

    static async inc(uid: number, updateFields: Partial<Coins>): Promise<boolean> {
        const cleanFields: any = { ...updateFields };
        if (cleanFields.total !== undefined) cleanFields.total = parseInt(cleanFields.total) || 0;
        if (cleanFields.checkin !== undefined) cleanFields.checkin = parseInt(cleanFields.checkin) || 0;
        if (cleanFields.stages !== undefined) cleanFields.stages = parseInt(cleanFields.stages) || 0;
        if (cleanFields.problems !== undefined) cleanFields.problems = parseInt(cleanFields.problems) || 0;
        if (cleanFields.bonus !== undefined) cleanFields.bonus = parseInt(cleanFields.bonus) || 0;

        const result = await this.coll.updateOne(
            { uid: uid },
            { $inc: cleanFields },
            { upsert: true }
        );
        return result.modifiedCount > 0;
    }

    static async getOne(uid: number) {
        const user = await this.coll.findOne({uid});
        if (!user) {
            await this.coll.insertOne({uid, total: 0, checkin: 0, stages: 0, problems: 0, bonus: 0});
        }
        return await this.coll.findOne({uid});
    }
}

class BillsModel {
    static coll = billsCollection;

    static async add(rootId: number, uid: number, goodsId: string, coins: number, content: string, check: number): Promise<ObjectId> {
        const result = await this.coll.insertOne({
            createAt: new Date(),
            rootId: rootId,
            uid: uid,
            goodsId: goodsId,
            coins: coins,
            content: content,
            check: check
        });
        return result.insertedId;
    }

    static async check(rootId: number, _id: ObjectId) {
        const result = await this.coll.updateOne(
            { _id: _id },
            {
                $set: {rootId: rootId, check: 1}
        });
        return result.modifiedCount;
    }

    static async withdraw(_id: ObjectId) {
        const result = await this.coll.deleteOne(
            { _id: _id }
        );
        return result.deletedCount;
    }

    static async updateContent(_id: ObjectId, content: string) {
        const result = await this.coll.updateOne(
            { _id: _id },
            {
                $set: { content: content}
        });
        return result.modifiedCount;
    }

    static async getOne(filter: Filter<Bills> = {}) {
        return await this.coll.findOne(filter);
    }

    static async getMany(filter: Filter<Bills> = {}): Promise<Bills[]> {
        return await this.coll.find(filter).sort({ createAt: -1}).toArray();
    }
}

class GoodsModel {
    static coll = goodsCollection;

    static async add(name: string, description: string, price: number, amount: number, limit: number, imageUrl: string, type: number, status: boolean) {
        const result = await this.coll.insertOne({
            name: name,
            description: description,
            price: price,
            amount: amount || 0, // 默认无穷多
            limit: limit || 0,  // 默认无限制
            imageUrl: imageUrl,
            type: type || 0,    // 默认实物
            status: status,
            sale: 0
        });
        return result.insertedId;
    }

    static async getOne(filter: Filter<Goods> = {}): Promise<Goods> {
        return await this.coll.findOne(filter);
    }

    static async getMany(filter: Filter<Goods> = {}): Promise<Goods[]> {
        return await this.coll.find(filter).sort({ _id: 1 }).toArray();
    }

    static async updateOne(_id: ObjectId, name: string, description: string, price: number, amount: number, limit: number, imageUrl: string, type: number, status: boolean): Promise<number> {
        const result = await this.coll.updateOne(
            { _id: _id },
            { $set: { name, description, price, amount, limit, imageUrl, type, status } }
        );
        return result.modifiedCount;
    }

    static async delete(_id: ObjectId): Promise<number> {
        const result = await GoodsModel.coll.deleteOne({ _id });
        return result.deletedCount;
    }

    static async hidden(_id: ObjectId): Promise<number> {
        const result = await this.coll.updateOne(
            { _id: _id },
            { $set: { status: false } }
        );
        return result.modifiedCount;
    }

    static async public(_id: ObjectId): Promise<number> {
        const result = await this.coll.updateOne(
            { _id: _id },
            { $set: { status: true } }
        );
        return result.modifiedCount;
    }

    static async updateStock(_id: ObjectId, amount: number): Promise<number> {  
        const result = await this.coll.updateOne(  
            { _id },  
            { $inc: { amount } }
        );
        return result.modifiedCount;  
    }

    static async updateSale(_id: ObjectId, sale: number): Promise<number> {  
        const result = await this.coll.updateOne(  
            { _id },  
            { $inc: { sale } }
        );
        return result.modifiedCount;  
    }
}

class BagModel {
    static coll = bagCollection;

    static async add(uid: number, goodsId: ObjectId, type: number, loaded: boolean) {
        const result = await this.coll.insertOne({
            uid: uid,
            goodsId: goodsId,
            type: type,
            loaded: loaded
        });

        return result.insertedId;
    }

    static async load(uid: number, goodsId: ObjectId) {
        const result = await this.coll.updateOne(
            { uid, goodsId },
            { $set: { loaded: true } }
        );
        return result.modifiedCount > 0;
    }

    static async unload(uid: number, goodsId: ObjectId) {
        const result = await this.coll.updateOne(
            { uid, goodsId },
            { $set: { loaded: false } }
        );
        return result.modifiedCount > 0;
    }

    static async getOne(filter: Filter<Bag> = {}) {
        return await this.coll.findOne(filter);
    }

    static async getMany(filter: Filter<Bag> = {}) {
        return await this.coll.find(filter).sort({ _id: -1 }).toArray();
    }
}

global.Hydro.model.coins = CoinsModel;
global.Hydro.model.bills = BillsModel;
global.Hydro.model.goods = GoodsModel;
global.Hydro.model.bag = BagModel;

export { CoinsModel, BillsModel, GoodsModel, BagModel };