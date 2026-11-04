import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User } from '../modules/auth/user.model.js';
import { categoryMaster, classifyLegacyProduct, detectFoodProduct, getCategorySelection } from '../modules/catalog/categoryMaster.js';
import { Product } from '../modules/catalog/product.model.js';
import { SellerApplication } from '../modules/seller/sellerApplication.model.js';

const applyChanges = process.argv.includes('--apply');
const reviewProducts: Array<{ id: string; name: string; food: boolean }> = [];
let productsScanned = 0;
let productsClassified = 0;
let foodProducts = 0;
let foodProductsUnpublished = 0;
let applicationsScanned = 0;
let applicationsClassified = 0;
let applicationsForReview = 0;

try {
  await connectDatabase();

  for await (const product of Product.find({}).select('_id name description category categoryId sellerId isActive approvalStatus').cursor()) {
    productsScanned += 1;
    if (product.categoryId) continue;

    const category = classifyLegacyProduct({
      name: product.name,
      description: product.description,
      category: product.category,
    });
    const isFoodProduct = category?.isFoodProduct ?? detectFoodProduct({ name: product.name, description: product.description });
    const foodCategory = isFoodProduct ? categoryMaster.find((entry) => entry.categoryId === 'food-items') : undefined;
    let foodComplianceStatus: 'not_required' | 'pending' | 'verified' = 'not_required';
    if (isFoodProduct) {
      foodProducts += 1;
      const application = product.sellerId
        ? await SellerApplication.findOne({
          sellerId: product.sellerId,
          status: 'approved',
          fssaiStatus: 'verified',
          fssaiRegistrationNumber: /^\d{14}$/,
        }).select('_id').lean()
        : null;
      foodComplianceStatus = application ? 'verified' : 'pending';
    }

    const publish = Boolean(product.isActive) && (!isFoodProduct || foodComplianceStatus === 'verified');
    if (Boolean(product.isActive) && isFoodProduct && !publish) foodProductsUnpublished += 1;
    const classificationStatus = category ? 'classified' : 'needs_review';
    const changes = {
      category: category?.categoryName ?? foodCategory?.categoryName ?? product.category,
      categoryId: category?.categoryId ?? foodCategory?.categoryId ?? null,
      categoryName: category?.categoryName ?? foodCategory?.categoryName ?? null,
      subcategoryId: category?.subcategoryId ?? null,
      subcategoryName: category?.subcategoryName ?? null,
      productType: category?.productType ?? product.name,
      isFoodProduct,
      classificationStatus,
      classificationNote: category ? null : 'Legacy product needs manual category and subcategory review.',
      approvalStatus: product.approvalStatus ?? (product.isActive ? 'approved' : 'pending'),
      foodComplianceStatus,
      isActive: publish,
    };

    if (category) productsClassified += 1;
    else reviewProducts.push({ id: String(product._id), name: product.name, food: isFoodProduct });
    if (applyChanges) await Product.updateOne({ _id: product._id }, { $set: changes }, { runValidators: true });
  }

  for await (const application of SellerApplication.find({}).select(
    '_id primaryProductType primaryCategoryId primarySubcategoryId primaryClassificationStatus fssaiRegistrationNumber',
  ).cursor()) {
    applicationsScanned += 1;
    if (application.primaryCategoryId) continue;

    const type = application.primaryProductType.toLowerCase();
    const selection = type === 'bangles' || type === 'jewellery'
      ? getCategorySelection('womens-apparel-accessories', 'jewellery-accessories', application.primaryProductType)
      : type === 'dupattas'
        ? getCategorySelection('womens-apparel-accessories', 'dupattas-scarves', 'Dupatta')
        : null;
    const hasExistingFoodComplianceDetails = type === 'others' && Boolean(application.fssaiRegistrationNumber);
    const changes = selection
      ? {
        primaryCategoryId: selection.categoryId,
        primaryCategoryName: selection.categoryName,
        primarySubcategoryId: selection.subcategoryId,
        primarySubcategoryName: selection.subcategoryName,
        primaryClassificationStatus: 'classified',
        primaryClassificationNote: null,
        fssaiStatus: 'not_required',
      }
      : {
        primaryCategoryId: null,
        primaryCategoryName: null,
        primarySubcategoryId: null,
        primarySubcategoryName: null,
        primaryClassificationStatus: 'needs_review',
        primaryClassificationNote: 'Legacy product type needs review before category-specific seller workflows can be applied.',
        fssaiStatus: hasExistingFoodComplianceDetails ? 'pending' : 'not_required',
      };
    if (selection) applicationsClassified += 1;
    else applicationsForReview += 1;
    if (applyChanges) await SellerApplication.updateOne({ _id: application._id }, { $set: changes }, { runValidators: true });
  }
} finally {
  await disconnectDatabase();
}

console.info(`${applyChanges ? 'Migration applied' : 'Dry run only'}:`);
console.info(`Products: ${productsScanned} scanned, ${productsClassified} classified, ${reviewProducts.length} need review.`);
console.info(`Food products: ${foodProducts} identified, ${foodProductsUnpublished} active products held until FSSAI verification.`);
console.info(`Seller applications: ${applicationsScanned} scanned, ${applicationsClassified} classified, ${applicationsForReview} need review.`);
if (reviewProducts.length) {
  console.info('Product records needing category review:');
  for (const product of reviewProducts) {
    console.info(`- ${product.id} | ${product.name} | ${product.food ? 'food compliance required' : 'category review required'}`);
  }
}
