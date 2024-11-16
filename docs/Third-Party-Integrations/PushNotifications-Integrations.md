
## Push Notification Forwarding to your phone

GridTracker can forward unseen chat messages and hits on the Call Roster to your phone through third-party services. We currently support [SimplePush.io](https://simplepush.io/) and [Pushover.net](https://pushover.net/). Both services can be tested, SimplePush allows 10 free messages per month while Pushover has a 30-day free trial. After that you will need to either purchase a subscription for SimplePush for $13 per year or do a one time in-app purchase in Pushover for $5 to get 10,000 messages free each month, no subscription required.

### How-To SimplePush.io notifications ###

Download the SimplePush.io app from the Apple Appstore or the Google Play store. Open the app and it will display a 6-letter code. This your API key:
![SimplePush Settings in GridTracker](../img/GT_SimplePush_Settings.png)
If you click the test button you should get a test message to your phone and GT should push CR hits and chat messages. Unfortunately you'll get only 10 messages per month for free.

### How-To Pushover.net notifications ###

Register on [pushover.net](https://pushover.net/) with a new user account. You'll get 30 days to test it out. Download the pushover.net app from the Apple Appstore or the Google Play store. Log in with your username/password. Go back to the [webpage](https://pushover.net) and create a new [Pushover application](https://pushover.net/apps/build). Call it GridTracker for example and check the terms of service box:

![Pushover Webpage New Application Screen](../img/Pushover_NewApplication.png)

You'll see this screen with your API token:
![Pushover Webpage New API Token](../img/Pushover_NewAPIToken.png)

Copy that token to the API token field for Pushover:
![GridTracker Pushover Settings API Token](../img/GT_Pushover_Cred_APIToken.png)

Go to the [pushover.net](https://pushover.net/) home page and find your user key:
![Pushover Webpage User Key](../img/Pushover_UserKey.png)

Now add your user key and click the test button:
![GridTracker Pushover Settings User Key](../img/GT_Pushover_Cred_UserKey.png)

You should now get notifications to your phone:

![PushOver Notification on Android Phone](../img/Android_PushoverNotification.jpg)

If you run your station 24/7 you'll no longer miss incoming OAMS chat messages nor Call Roster hits. GridTracker has to be running though, no messages will be sent to your phone otherwise.
