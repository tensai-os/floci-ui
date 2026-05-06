import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom'
import {Layout} from '@/components/Layout'
import {DashboardPage} from '@/features/dashboard/DashboardPage'
import {ServicePage} from '@/features/service/ServicePage'
import {CloudWatchPage} from '@/features/cloudwatch/CloudWatchPage'
import {S3Page} from '@/features/s3/S3Page'
import {SQSPage} from '@/features/sqs/SQSPage'
import {DynamoDBPage} from '@/features/dynamodb/DynamoDBPage'
import {LambdaPage} from '@/features/lambda/LambdaPage'
import {SNSPage} from '@/features/sns/SNSPage'

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route element={<Layout/>}>
                    <Route index element={<Navigate to="/dashboard" replace/>}/>
                    <Route path="/dashboard" element={<DashboardPage/>}/>
                    <Route path="/cloudwatch" element={<CloudWatchPage/>}/>
                    <Route path="/s3" element={<S3Page/>}/>
                    <Route path="/sqs" element={<SQSPage/>}/>
                    <Route path="/lambda" element={<LambdaPage/>}/>
                    <Route path="/dynamodb" element={<DynamoDBPage/>}/>
                    <Route path="/sns" element={<SNSPage/>}/>
                    <Route path="/:service" element={<ServicePage/>}/>
                    <Route path="*" element={<Navigate to="/dashboard" replace/>}/>
                </Route>
            </Routes>
        </BrowserRouter>
    )
}
