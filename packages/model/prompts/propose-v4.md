המשימה: קיבלת שינויים במסמך מקור. החזר הצעה אחת לכל שינוי, בפורמט JSON: {"suggestions":[...]}.

בחירת type — בדוק לפי הסדר, ועצור בראשון שמתאים:

1. לפסקה יש שלב ממופה עם blockId → type=update-block. targetBlockId = אותו blockId. actions = כל ההוראות של הבלוק, מעודכנות. אל תחזיר גם update-step לאותה פסקה.
2. הפסקה נמחקה (kind=removed) ויש לה שלב ממופה → type=deprecate-step. reason = משפט קצר שאומר שהפסקה נמחקה במקור.
3. הפסקה מזכירה שם שדה CRM שאינו ברשימת "שדות CRM מוכרים" → type=field-alert. fieldName = השם הישן מהרשימה, issue=renamed.
4. לפסקה יש שלב ממופה והשינוי הוא ערך/סף/הוראה → type=update-step. actions = ההוראות החדשות בלבד.
5. הפסקה חדשה (kind=added) ואין לה שלב ממופה, אבל יש שלבים ממופים אחרים באותו מסמך → type=new-step. targetDocumentId = אותו מסמך, afterStepKey = השלב שלפניו, actions = ההוראות של השלב החדש.
6. אין שלבים ממופים כלל במסמך → type=new-card, כרטיס אחד לכל סעיף, actions = פסקה אחת לכל שלב. השאר את targetDocumentId, targetStepKey ו-targetBlockId ריקים ("").

מזהים: targetDocumentId, targetStepKey, targetBlockId ו-afterStepKey — העתק את הערך בדיוק כפי שהוא מופיע ברשימת "שלבים ממופים" למטה. אל תמציא מזהה ואל תקצר אותו. אם אין ערך מתאים, כתוב "".

כתיבה: title ו-actions בעברית תפעולית קצרה, פעולה אחת בכל שורה. rationale = משפט אחד בעברית שאומר על מה השינוי משפיע (מסמכים, בלוקים, שדות) ולמה. אם מצורפת "השפעה" — הזכר אותה ב-rationale.

דוגמאות (השדות הריקים הושמטו כאן לקיצור; אתה חייב להחזיר את כולם):

update-step — §4.8 changed "מעל 5 מגה תקין" → "מעל 6 מגה תקין"; שלב ממופה documentId=11111111-1111-4111-8111-111111111111 stepKey=s8
{"anchor":"§4.8","type":"update-step","title":"סף Speedtest: 5 → 6 מגה","targetDocumentId":"11111111-1111-4111-8111-111111111111","targetStepKey":"s8","targetBlockId":"","actions":["ודא שתוצאת Speedtest מעל 6 מגה"],"rationale":"הסף המספרי בפסקה 4.8 עלה מ-5 ל-6 מגה ומשפיע על שלב 8 ב\"איטיות גלישה\"."}

update-block — §2.3 changed; לשלב הממופה יש blockId=44444444-4444-4444-8444-444444444444 בשימוש ב-9 מסמכים
{"anchor":"§2.3","type":"update-block","title":"ריענון SIM: המתנה 90 שניות","targetDocumentId":"22222222-2222-4222-8222-222222222222","targetStepKey":"s3","targetBlockId":"44444444-4444-4444-8444-444444444444","actions":["בצע ריענון SIM בקונסולה","המתן 90 שניות","אם אין קליטה — בקש אתחול מכשיר"],"rationale":"הבלוק המשותף \"ריענון SIM\" מוטמע ב-9 מסמכים, ולכן ההוראות מתעדכנות בבלוק ולא בשלב."}

deprecate-step — §5.2 removed; שלב ממופה s12
{"anchor":"§5.2","type":"deprecate-step","title":"הוצאה משימוש: בדיקה במסוף הישן","targetDocumentId":"11111111-1111-4111-8111-111111111111","targetStepKey":"s12","targetBlockId":"","actions":[],"reason":"הפסקה 5.2 נמחקה במסמך המקור.","rationale":"הפסקה נמחקה במקור, ולכן השלב יוצא משימוש."}

field-alert — §2.7 changed 'השדה "sim block lbl"' → 'השדה "sim status"'; ברשימת השדות המוכרים יש רק "sim block lbl"
{"anchor":"§2.7","type":"field-alert","title":"שדה CRM שונה: sim block lbl → sim status","targetDocumentId":"22222222-2222-4222-8222-222222222222","targetStepKey":"s7","targetBlockId":"","actions":[],"fieldName":"sim block lbl","issue":"renamed","rationale":"המקור מפנה ל\"sim status\" בעוד ברשימת שדות ה-CRM מופיע \"sim block lbl\"."}

new-step — §4.10 added; אין לו שלב ממופה, אבל §4.9 ממופה לשלב s9 באותו מסמך
{"anchor":"§4.10","type":"new-step","title":"תיעוד תוצאת הבדיקה","targetDocumentId":"11111111-1111-4111-8111-111111111111","targetStepKey":"","targetBlockId":"","afterStepKey":"s9","actions":["תעד את תוצאת הבדיקה בכרטיס הפנייה לפני סגירתה"],"rationale":"פסקה 4.10 מוסיפה פעולה אחרי שלב 9 ב\"איטיות גלישה\"."}

new-card — מקור חדש, אין שלבים ממופים; סעיף "זיהוי הלקוח"
{"anchor":"§h2-1","type":"new-card","title":"זיהוי הלקוח","targetDocumentId":"","targetStepKey":"","targetBlockId":"","actions":["ודא את זהות הלקוח מול תעודה מזהה"],"rationale":"סעיף חדש במקור ללא שלב מקושר."}
